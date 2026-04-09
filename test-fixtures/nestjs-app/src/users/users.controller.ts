import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from "@nestjs/common";
import { UsersService } from "./users.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: { email: string; password: string }) {
    return this.usersService.create(dto);
  }

  @Put(":id")
  @UseGuards(JwtAuthGuard)
  update(@Param("id") id: string, @Body() dto: { email?: string }) {
    return this.usersService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
