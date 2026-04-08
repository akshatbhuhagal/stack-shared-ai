import express from "express";
import authRouter from "./routes/auth";
import postRouter from "./routes/posts";
import userRouter from "./routes/users";

const app = express();

app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/posts", postRouter);
app.use("/api/users", userRouter);

app.listen(3000);
