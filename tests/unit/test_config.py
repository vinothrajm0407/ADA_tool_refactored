"""
Unit tests for Config class in config.py.

Validates that Config reads environment variables correctly,
applies correct defaults, and parses compound types (int lists, booleans).
"""
import os
import importlib
import pytest


def _reload_config_with_env(**env_overrides):
    """
    Temporarily override env vars, reload config module, return Config class.
    Always restores original env after the call.
    """
    original = {k: os.environ.get(k) for k in env_overrides}
    for k, v in env_overrides.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = str(v)
    try:
        import config
        importlib.reload(config)
        return config.Config
    finally:
        for k, v in original.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(config)


class TestConfigDefaults:
    def test_jwt_secret_has_default(self):
        from config import Config
        assert isinstance(Config.JWT_SECRET, str)
        assert len(Config.JWT_SECRET) > 0

    def test_jwt_expire_hours_default_24(self):
        C = _reload_config_with_env(JWT_EXPIRE_HOURS=None)
        assert C.JWT_EXPIRE_HOURS == 24

    def test_scan_rate_limit_window_default_300s(self):
        C = _reload_config_with_env(SCAN_TIMEOUT_SECONDS=None)
        assert C.SCAN_TIMEOUT_SECONDS == 300

    def test_crawl_max_depth_default(self):
        C = _reload_config_with_env(CRAWL_MAX_DEPTH=None)
        assert C.CRAWL_MAX_DEPTH == 3

    def test_crawl_max_pages_default(self):
        C = _reload_config_with_env(CRAWL_MAX_PAGES=None)
        assert C.CRAWL_MAX_PAGES == 50

    def test_smtp_enabled_false_by_default(self):
        C = _reload_config_with_env(SMTP_ENABLED=None)
        assert C.SMTP_ENABLED is False

    def test_scheduler_enabled_true_by_default(self):
        C = _reload_config_with_env(SCHEDULER_ENABLED=None)
        assert C.SCHEDULER_ENABLED is True

    def test_alert_score_drop_threshold_default(self):
        C = _reload_config_with_env(ALERT_SCORE_DROP_THRESHOLD=None)
        assert C.ALERT_SCORE_DROP_THRESHOLD == 5


class TestConfigEnvOverrides:
    def test_custom_jwt_expire_hours(self):
        C = _reload_config_with_env(JWT_EXPIRE_HOURS="48")
        assert C.JWT_EXPIRE_HOURS == 48

    def test_custom_crawl_max_pages(self):
        C = _reload_config_with_env(CRAWL_MAX_PAGES="200")
        assert C.CRAWL_MAX_PAGES == 200

    def test_smtp_enabled_truthy_values(self):
        for val in ("true", "1", "yes"):
            C = _reload_config_with_env(SMTP_ENABLED=val)
            assert C.SMTP_ENABLED is True, f"SMTP_ENABLED={val} should be True"

    def test_smtp_disabled_falsy_values(self):
        for val in ("false", "0", "no"):
            C = _reload_config_with_env(SMTP_ENABLED=val)
            assert C.SMTP_ENABLED is False, f"SMTP_ENABLED={val} should be False"

    def test_scheduler_disabled(self):
        C = _reload_config_with_env(SCHEDULER_ENABLED="false")
        assert C.SCHEDULER_ENABLED is False

    def test_retry_intervals_parsed_as_int_list(self):
        C = _reload_config_with_env(SCAN_JOB_RETRY_INTERVALS="10,20,30")
        assert C.SCAN_JOB_RETRY_INTERVALS == [10, 20, 30]

    def test_retry_intervals_default(self):
        C = _reload_config_with_env(SCAN_JOB_RETRY_INTERVALS=None)
        assert C.SCAN_JOB_RETRY_INTERVALS == [15, 30]

    def test_is_production_when_app_env_production(self):
        C = _reload_config_with_env(APP_ENV="production")
        assert C.IS_PRODUCTION is True

    def test_not_production_in_development(self):
        C = _reload_config_with_env(APP_ENV="development")
        assert C.IS_PRODUCTION is False


class TestConfigSensitiveFields:
    def test_default_jwt_secret_is_insecure_placeholder(self):
        C = _reload_config_with_env(JWT_SECRET=None)
        assert "change-me" in C.JWT_SECRET.lower() or len(C.JWT_SECRET) < 64

    def test_ai_summary_enabled_when_key_present(self):
        C = _reload_config_with_env(ANTHROPIC_API_KEY="sk-ant-test")
        assert C.AI_SUMMARY_ENABLED is True

    def test_ai_summary_disabled_when_no_key(self):
        C = _reload_config_with_env(ANTHROPIC_API_KEY=None)
        assert C.AI_SUMMARY_ENABLED is False
