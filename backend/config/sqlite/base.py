"""SQLite transactions acquire the writer lock before reading mutable data.

Deferred read-to-write upgrades can fail immediately under concurrent Sheet and
HTTP writes, even with busy_timeout. IMMEDIATE waits before taking a snapshot.
WAL lets readers continue while a writer holds the reserved transaction lock.
"""
from django.db.backends.sqlite3.base import DatabaseWrapper as SQLiteWrapper


class DatabaseWrapper(SQLiteWrapper):
    def get_new_connection(self, conn_params):
        connection = super().get_new_connection(conn_params)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
        except Exception:
            connection.close()
            raise
        return connection

    def _start_transaction_under_autocommit(self):
        self.cursor().execute("BEGIN IMMEDIATE")
