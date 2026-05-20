import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { buildRouter } from "./routes/build.js";
import { fixturesRouter } from "./routes/fixtures.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", buildRouter);
app.use("/api", fixturesRouter);

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (profile=${env.profile})`);
});
