// Native Bun.serve with route map (Bun 1.2+)
Bun.serve({
  port: 3000,
  routes: {
    "/": new Response("Hello from Bun!"),
    "/health": new Response("ok"),
    "/api/users": {
      GET: async () => Response.json({ users: [] }),
      POST: async (req) => {
        const body = await req.json();
        return Response.json({ created: body }, { status: 201 });
      },
    },
    "/api/users/:id": {
      GET: async (req) => Response.json({ id: req.params.id }),
      DELETE: async (req) => Response.json({ deleted: req.params.id }),
    },
  },
});
