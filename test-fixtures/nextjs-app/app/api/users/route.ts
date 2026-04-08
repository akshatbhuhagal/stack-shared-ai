import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json({ created: body }, { status: 201 });
}
