"use server";

export async function createPost(formData: FormData) {
  const title = formData.get("title");
  return { ok: true, title };
}

export async function deletePost(id: string) {
  return { ok: true, id };
}
