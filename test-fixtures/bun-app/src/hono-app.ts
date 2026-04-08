import { Hono } from "hono";

const app = new Hono();

app.get("/posts", (c) => c.json({ posts: [] }));
app.post("/posts", async (c) => {
  const body = await c.req.json();
  return c.json({ created: body }, 201);
});
app.get("/posts/:id", (c) => c.json({ id: c.req.param("id") }));
app.delete("/posts/:id", (c) => c.json({ deleted: c.req.param("id") }));

export default app;
