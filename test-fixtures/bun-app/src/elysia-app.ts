import { Elysia } from "elysia";

const app = new Elysia()
  .get("/comments", () => ({ comments: [] }))
  .post("/comments", ({ body }) => ({ created: body }))
  .get("/comments/:id", ({ params }) => ({ id: params.id }));

export default app;
