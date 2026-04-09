import { Injectable } from "@nestjs/common";

@Injectable()
export class UsersService {
  async findAll(): Promise<any[]> {
    return [];
  }

  async findOne(id: string): Promise<any> {
    return { id };
  }

  async create(dto: { email: string; password: string }): Promise<any> {
    return dto;
  }

  async update(id: string, dto: { email?: string }): Promise<any> {
    return { id, ...dto };
  }

  async remove(id: string): Promise<void> {
    return;
  }
}
