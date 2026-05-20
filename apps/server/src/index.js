import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { buildRouter } from "./routes/build.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", buildRouter);

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (profile=${env.profile})`);
});
