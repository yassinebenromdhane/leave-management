// /api/operator/*: one router, one requireOperator guard for every operator route.
import { Hono } from "hono";
import { requireOperator, type OperatorEnv } from "../../auth/middleware";
import { operatorAccessRoutes } from "./access";
import { accrualRoutes } from "./accrual";
import { attachmentRoutes } from "./attachments";
import { employeeRoutes } from "./employees";
import { holidayRoutes } from "./holidays";
import { leaveRoutes } from "./leaves";
import { referenceRoutes } from "./reference";
import { reportRoutes } from "./reports";
import { settingsRoutes } from "./settings";

export const operatorRoutes = new Hono<OperatorEnv>()
  .use(requireOperator)
  .route("/", referenceRoutes)
  .route("/employees", employeeRoutes)
  .route("/employees", operatorAccessRoutes)
  .route("/leaves", leaveRoutes)
  .route("/attachments", attachmentRoutes)
  .route("/", settingsRoutes)
  .route("/holidays", holidayRoutes)
  .route("/accrual", accrualRoutes)
  .route("/reports", reportRoutes);
