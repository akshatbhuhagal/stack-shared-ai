import { Controller, Post, Body } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() dto: { email: string; password: string }) {
    return this.authService.login(dto);
  }

  @Post("register")
  register(@Body() dto: { email: string; password: string }) {
    return this.authService.register(dto);
  }
}
