import logging
from datetime import datetime
from config import Config
from backend.services.queue_service import QueueService
from services.url_validation import validate_url_for_scan as validate_scan_url
from backend.services.url_processor import run_ada_scan
from services import db

logger = logging.getLogger(__name__)

queue_service = None


def get_queue_service():
    global queue_service
    if queue_service is None:
        queue_service = QueueService()
    return queue_service


def _format_enqueued_at(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def create_scan_job(url: str, metadata: dict | None = None, login: dict | None = None):
    """login (with the password) goes to the task only, never into metadata,
    which is saved with the job."""
    metadata = metadata or {}
    normalized_url = validate_scan_url(url)
    if login:
        validate_scan_url(login["url"])
    job_meta = {"scan_url": normalized_url, "metadata": metadata}

    try:
        job = get_queue_service().enqueue_scan(
            run_ada_scan,
            normalized_url,
            metadata,
            timeout=Config.SCAN_TIMEOUT_SECONDS,
            meta=job_meta,
            **({"login": login} if login else {}),
        )
    except Exception as exc:
        logger.error("Failed to enqueue scan job", exc_info=exc)
        raise

    enqueued_at = _format_enqueued_at(getattr(job, "enqueued_at", None))
    if db.is_ready():
        try:
            db.save_scan_job(
                job_id=job.id,
                url=normalized_url,
                metadata=metadata,
                status="pending",
                created_at=enqueued_at,
                attempt=1,
            )
        except Exception:
            logger.exception("Failed to persist pending scan job %s", job.id)

    return {
        "job_id": job.id,
        "status": "queued",
        "backend": queue_service.get_backend(),
        "enqueued_at": enqueued_at,
    }


def get_scan_status(job_id: str):
    return get_queue_service().get_job_status(job_id)


