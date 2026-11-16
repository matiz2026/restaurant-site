import { handleRequest } from "./app.ts";
import { fromD1 } from "./db.ts";
import { defaultUploadsDir } from "./uploads.ts";

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, {
        db: fromD1(env.DB),
        sessionSecret: env.SESSION_SECRET,
        assets: env.ASSETS,
        uploadsDir: defaultUploadsDir(),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "worker_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      return new Response("Something went wrong.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
