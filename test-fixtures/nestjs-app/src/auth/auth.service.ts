import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: { email: string; password: string }): Promise<{ token: string }> {
    const secret = this.configService.get<string>("JWT_SECRET");
    return { token: this.jwt.sign({ email: dto.email }, { secret }) };
  }

  async register(dto: { email: string; password: string }): Promise<{ id: string }> {
    return { id: "new" };
  }
}
