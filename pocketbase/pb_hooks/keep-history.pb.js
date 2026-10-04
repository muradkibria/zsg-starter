/// <reference path="../pb_data/types.d.ts" />
// DigiLite Hub keeps its history permanently, so these records can't be deleted:
// not by the API server, not from the admin UI and not by a cascade.
//
//   gps_points, plays, bag_days, screenshots   what each bag did, day by day
//   commands, deployments                      every change sent (or tried) to a bag
//   audit_log                                  who did what
//   payroll_periods                            pay periods, including approved ones
//
// Each hook callback runs in its own JS runtime and can't see anything declared at
// the top of this file, so everything it needs is inside the callback.

onRecordDelete(
  (e) => {
    const what = {
      gps_points: "GPS points",
      plays: "Ad plays",
      bag_days: "Bag days",
      screenshots: "Screenshots",
      commands: "Changes sent to bags",
      deployments: "Loop sends",
      audit_log: "Audit log entries",
      payroll_periods: "Pay periods",
    }[e.record.collection().name];
    throw new BadRequestError((what || "These records") + " are kept permanently and can't be deleted.");
  },
  "gps_points",
  "plays",
  "bag_days",
  "screenshots",
  "commands",
  "deployments",
  "audit_log",
  "payroll_periods",
);
