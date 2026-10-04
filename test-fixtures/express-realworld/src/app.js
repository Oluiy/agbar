const pool = new Pool({ max: 10 });

app.get("/health", (req, res) => res.send("ok"));

// Real pagination bug: no LIMIT, grows with the table.
app.get("/articles", async (req, res) => {
  const rows = await pool.query("SELECT * FROM articles");
  res.json(rows);
});

// Loop over a small, bounded, admin-time list of table names - not row-scale
// data. Today's rule can't tell the difference; that's the point of this case.
function reindexAllTables(tableNames) {
  for (const name of tableNames) {
    db.query(`REINDEX TABLE ${name}`);
  }
}
