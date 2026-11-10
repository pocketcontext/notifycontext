// Commit an account change and its directory entry together, including inside batch transactions.
// Disabled and unverified accounts stay listed (history keeps their names) but are not active.
function sync(e, deleting) {
  const app = e.app;
  app.runInTransaction((txApp) => {
    e.app = txApp;
    try {
      e.next();
      const rows = txApp.findRecordsByFilter("user_directory", "id = {:id}", "", 1, 0, {id: e.record.id});
      if (deleting) {
        if (rows.length) txApp.delete(rows[0]);
        return;
      }
      const row = rows.length ? rows[0] : new Record(txApp.findCollectionByNameOrId("user_directory"));
      const name = e.record.getString("name");
      const active = e.record.getBool("verified") && !e.record.getBool("disabled");
      if (rows.length && row.getString("name") === name && row.getBool("active") === active) return;
      row.set("id", e.record.id);
      row.set("name", name);
      row.set("active", active);
      txApp.save(row);
    } finally {
      e.app = app;
    }
  });
}

module.exports = {sync};
