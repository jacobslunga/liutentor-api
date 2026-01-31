import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabaseMiddleware } from "~/db/supabase";
import exams from "~/api/v1/exams.routes";
import { fail } from "~/utils/response";
import { rateLimit } from "~/middleware/ratelimit";

const app = new Hono().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(fail(err.message), err.status);
  }

  console.error(err);

  return c.json(fail("Internal server error"), 500);
});

app.use(supabaseMiddleware);
app.use("/v1/exams/*", rateLimit);

app.route("/", exams);

export default app;
