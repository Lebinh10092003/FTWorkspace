import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from django.db import connections
from django.db import OperationalError
from django.db.backends.sqlite3.base import DatabaseWrapper as DeferredSQLiteWrapper
from .sqlite.base import DatabaseWrapper
from .api_errors import exception_handler


class APIErrorHandlingTests(unittest.TestCase):
    def test_lock_error_is_retryable_and_logs_do_not_contain_request_data(self):
        request = SimpleNamespace(path="/api/work-schedule/day")
        with self.assertLogs("config.api_errors", level="ERROR") as captured:
            response = exception_handler(OperationalError("database is locked"), {"request": request})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["code"], "database_busy")
        self.assertEqual(response["Retry-After"], "1")
        with self.assertLogs("config.api_errors", level="ERROR") as captured:
            response = exception_handler(RuntimeError("private task title and account credentials"), {"request": request})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("private task", str(response.data))
        self.assertNotIn("account credentials", " ".join(captured.output))


class ConcurrentSQLiteWritesTests(unittest.TestCase):
    def test_previous_deferred_transaction_reproduces_database_locked(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = connections.databases["default"].copy()
            settings["NAME"] = str(Path(directory) / "old-transaction.sqlite3")
            writer = DatabaseWrapper(settings.copy(), alias="isolated-writer")
            reader = DeferredSQLiteWrapper(settings.copy(), alias="isolated-reader")
            try:
                with writer.cursor() as cursor:
                    cursor.execute("CREATE TABLE save_counter (value INTEGER)")
                    cursor.execute("INSERT INTO save_counter VALUES (0)")
                reader.set_autocommit(False, force_begin_transaction_with_broken_autocommit=True)
                with reader.cursor() as cursor:
                    cursor.execute("SELECT value FROM save_counter")
                    self.assertEqual(cursor.fetchone()[0], 0)
                with writer.cursor() as cursor:
                    cursor.execute("UPDATE save_counter SET value=1")
                with self.assertRaisesRegex(OperationalError, "database is locked"):
                    with reader.cursor() as cursor:
                        cursor.execute("UPDATE save_counter SET value=2")
            finally:
                reader.rollback()
                reader.close()
                writer.close()

    def test_concurrent_read_modify_write_transactions_do_not_lose_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = connections.databases["default"].copy()
            settings["NAME"] = str(Path(directory) / "concurrent.sqlite3")
            def new_connection():
                return DatabaseWrapper(settings.copy(), alias="isolated-concurrency")
            setup = new_connection()
            with setup.cursor() as cursor:
                cursor.execute("CREATE TABLE save_counter (id INTEGER PRIMARY KEY, value INTEGER)")
                cursor.execute("INSERT INTO save_counter VALUES (1, 0)")
            setup.close()
            def write_many(_):
                db = new_connection()
                try:
                    for _ in range(12):
                        db.set_autocommit(False, force_begin_transaction_with_broken_autocommit=True)
                        with db.cursor() as cursor:
                            cursor.execute("SELECT value FROM save_counter WHERE id=1")
                            value = cursor.fetchone()[0]
                            time.sleep(0.002)
                            cursor.execute("UPDATE save_counter SET value=%s WHERE id=1", [value + 1])
                        db.commit()
                        db.set_autocommit(True)
                finally:
                    db.close()
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(write_many, range(4)))
            checked = new_connection()
            try:
                with checked.cursor() as cursor:
                    cursor.execute("SELECT value FROM save_counter WHERE id=1")
                    self.assertEqual(cursor.fetchone()[0], 48)
                    cursor.execute("PRAGMA journal_mode")
                    self.assertEqual(cursor.fetchone()[0], "wal")
            finally:
                checked.close()
