import logging
import os
import threading
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from types import SimpleNamespace

try:
    import redis
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover
    redis = None
    RedisError = Exception

try:
    from rq import Queue, Retry
    from rq.job import Job, JobStatus
    from rq.results import Result as RQResult
except ImportError:  # pragma: no cover
    Queue = None
    Retry = None
    Job = None
    JobStatus = None
    RQResult = None

from config import Config
from backend.utils.logging import configure_logging

configure_logging(Config.LOG_LEVEL)

logger = logging.getLogger(__name__)


class QueueService:
    def __init__(self):
        self.redis_url = Config.REDIS_URL
        self.queue_name = os.getenv("SCAN_QUEUE_NAME", Config.SCAN_QUEUE_NAME)
        self._client = None
        self._queue = None
        self._executor = None
        self._inmemory_jobs: dict = {}
        self._inmemory_lock = threading.Lock()
        self._backend = None
        self._connected = False
        self._connect()

    def _connect(self):
        if self.redis_url and redis is not None and Queue is not None:
            try:
                self._client = redis.from_url(self.redis_url, socket_connect_timeout=5)
                self._queue = Queue(name=self.queue_name, connection=self._client)
                self._connected = self._client.ping()
                self._backend = "redis"
                logger.info(
                    "Queue backend: Redis | url=%s queue=%s",
                    self.redis_url, self.queue_name,
                )
                return
            except RedisError as exc:
                logger.error(
                    "Queue backend: Redis unavailable | url=%s error=%s",
                    self.redis_url, exc,
                )
                if not Config.ALLOW_LOCAL_QUEUE_FALLBACK:
                    raise RuntimeError(
                        f"Unable to connect to Redis at {self.redis_url}: {exc}"
                    ) from exc
        elif self.redis_url:
            logger.warning(
                "Queue backend: Redis/RQ package missing, cannot use Redis backend."
            )

        if Config.ALLOW_LOCAL_QUEUE_FALLBACK:
            self._executor = ThreadPoolExecutor(max_workers=Config.SCAN_WORKER_MAX_WORKERS)
            self._backend = "inmemory"
            self._connected = True
            logger.warning(
                "Queue backend: in-memory fallback active (dev only) | workers=%d",
                Config.SCAN_WORKER_MAX_WORKERS,
            )
            return

        raise RuntimeError("REDIS_URL is required; in-memory fallback is disabled")

    @staticmethod
    def _function_reference(task_func):
        if isinstance(task_func, str):
            return task_func
        module = getattr(task_func, "__module__", None)
        name = getattr(task_func, "__name__", None)
        if module and name:
            return f"{module}.{name}"
        return task_func

    def enqueue_scan(self, task_func, *args, timeout=None, retry=None, meta=None, **kwargs):
        if not self._connected:
            raise RuntimeError("Queue is not available")

        timeout = timeout or Config.SCAN_TIMEOUT_SECONDS
        meta = meta or {}

        if self._backend == "redis":
            retry = retry or Retry(
                max=Config.SCAN_JOB_RETRY_MAX,
                interval=Config.SCAN_JOB_RETRY_INTERVALS,
            )
            job = self._queue.enqueue(
                self._function_reference(task_func),
                *args,
                **kwargs,
                job_timeout=timeout,
                retry=retry,
                meta=meta,
                result_ttl=Config.SCAN_JOB_RESULT_TTL,
                failure_ttl=Config.SCAN_JOB_FAILURE_TTL,
            )
            return job

        job_id = uuid.uuid4().hex
        created_at = datetime.utcnow().isoformat() + "Z"
        fut = self._executor.submit(task_func, *args, **kwargs)
        with self._inmemory_lock:
            self._inmemory_jobs[job_id] = {
                "future": fut,
                "meta": meta,
                "created_at": created_at,
            }
            self._prune_inmemory_jobs()
        return SimpleNamespace(id=job_id, enqueued_at=created_at)

    def _prune_inmemory_jobs(self):
        """Remove completed in-memory jobs when dict grows large. Must be called under lock."""
        if len(self._inmemory_jobs) < 200:
            return
        done_ids = [jid for jid, e in self._inmemory_jobs.items() if e["future"].done()]
        for jid in done_ids:
            del self._inmemory_jobs[jid]
        if done_ids:
            logger.debug("Pruned %d completed in-memory jobs", len(done_ids))

    def get_job_status(self, job_id):
        if self._backend == "redis":
            try:
                job = Job.fetch(job_id, connection=self._client)
            except Exception as exc:
                logger.warning("Failed to fetch job %s from Redis: %s", job_id, exc)
                return None

            status = job.get_status()

            # Use RQ 2.x API (return_value() / latest_result()) — suppress deprecation noise.
            result = None
            try:
                result = job.return_value()
            except Exception:
                result = None

            meta = getattr(job, "meta", {}) or {}

            failure_reason = meta.get("failure_reason")
            if not failure_reason and str(status) == "failed":
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", DeprecationWarning)
                        lr = job.latest_result()
                    if lr and RQResult and lr.type == RQResult.Type.FAILED and lr.exc_string:
                        lines = [ln.strip() for ln in lr.exc_string.strip().splitlines() if ln.strip()]
                        failure_reason = lines[-1] if lines else "Scan failed"
                except Exception:
                    failure_reason = "Scan failed"

            # Compute attempt number from retries_left (RQ 2.x has no attempt_number).
            retries_left = getattr(job, "retries_left", None)
            attempt = None
            if retries_left is not None:
                attempt = Config.SCAN_JOB_RETRY_MAX - retries_left + 1

            return {
                "job_id": job.id,
                "status": status,
                "backend": "redis",
                "scan_url": meta.get("scan_url"),
                "created_at": job.enqueued_at.isoformat() if job.enqueued_at else None,
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "ended_at": job.ended_at.isoformat() if job.ended_at else None,
                "failure_reason": failure_reason,
                "attempt": attempt,
                "meta": meta,
                "result": result,
            }

        with self._inmemory_lock:
            entry = self._inmemory_jobs.get(job_id)
        if entry is None:
            return None

        fut = entry["future"]
        meta = entry["meta"]
        created_at = entry["created_at"]

        if not fut.done():
            return {
                "job_id": job_id,
                "status": "queued",
                "backend": "inmemory",
                "scan_url": meta.get("scan_url"),
                "created_at": created_at,
                "meta": meta,
            }
        try:
            result = fut.result()
            return {
                "job_id": job_id,
                "status": "finished",
                "backend": "inmemory",
                "scan_url": meta.get("scan_url"),
                "created_at": created_at,
                "ended_at": datetime.utcnow().isoformat() + "Z",
                "meta": meta,
                "result": result,
            }
        except Exception as exc:
            return {
                "job_id": job_id,
                "status": "failed",
                "backend": "inmemory",
                "scan_url": meta.get("scan_url"),
                "created_at": created_at,
                "ended_at": datetime.utcnow().isoformat() + "Z",
                "failure_reason": str(exc),
                "meta": meta,
            }

    def enqueue_crawl(
        self,
        task_func,
        crawl_id: str,
        root_url: str,
        max_depth: int,
        max_pages: int,
        notify_email: str = None,
        user_id: int = None,
    ):
        """Enqueue a site crawl task. No retry — crawls are long-running and non-idempotent."""
        if not self._connected:
            raise RuntimeError("Queue is not available")

        timeout = Config.CRAWL_TIMEOUT_SECONDS

        if self._backend == "redis":
            job = self._queue.enqueue(
                self._function_reference(task_func),
                crawl_id=crawl_id,
                root_url=root_url,
                max_depth=max_depth,
                max_pages=max_pages,
                notify_email=notify_email,
                user_id=user_id,
                job_timeout=timeout,
                result_ttl=Config.SCAN_JOB_RESULT_TTL,
                failure_ttl=Config.SCAN_JOB_FAILURE_TTL,
            )
            return job

        job_id = uuid.uuid4().hex
        created_at = datetime.utcnow().isoformat() + "Z"
        fut = self._executor.submit(task_func, crawl_id=crawl_id, root_url=root_url, max_depth=max_depth, max_pages=max_pages, notify_email=notify_email, user_id=user_id)
        with self._inmemory_lock:
            self._inmemory_jobs[job_id] = {
                "future": fut,
                "meta": {"crawl_id": crawl_id, "root_url": root_url, "notify_email": notify_email},
                "created_at": created_at,
            }
            self._prune_inmemory_jobs()
        return SimpleNamespace(id=job_id, enqueued_at=created_at)

    def health_check(self) -> dict:
        return {
            "backend": self._backend,
            "connected": self._connected,
            "queue_name": self.queue_name,
            "redis_url": self.redis_url if self._backend == "redis" else None,
        }

    def is_ready(self) -> bool:
        return self._connected

    def get_backend(self) -> str:
        return self._backend
