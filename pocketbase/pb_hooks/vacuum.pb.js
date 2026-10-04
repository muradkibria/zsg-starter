/// <reference path="../pb_data/types.d.ts" />
// POST /api/custom/vacuum (superuser only): compacts the database file. The data
// only grows (nothing is deleted), so this is rarely worth running.

routerAdd(
  "POST",
  "/api/custom/vacuum",
  (e) => {
    $app.db().newQuery("VACUUM").execute();
    return e.json(200, { ok: true });
  },
  $apis.requireSuperuserAuth(),
);
