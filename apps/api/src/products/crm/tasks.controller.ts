import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from '@voltex/shared';
import { RequirePermissions } from '../../common/decorators';
import { TasksService } from './tasks.service';

class CreateTaskDto extends createZodDto(createTaskSchema) {}
class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
class ListTasksQueryDto extends createZodDto(listTasksQuerySchema) {}

@ApiTags('CRM · Tarefas')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('crm.task.read')
  list(@Query() query: ListTasksQueryDto) {
    return this.tasks.list(query);
  }

  @Post()
  @RequirePermissions('crm.task.write')
  create(@Body() body: CreateTaskDto) {
    return this.tasks.create(body);
  }

  @Get(':id')
  @RequirePermissions('crm.task.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(id);
  }

  @Patch(':id')
  @RequirePermissions('crm.task.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTaskDto) {
    return this.tasks.update(id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('crm.task.write')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.complete(id);
  }

  @Delete(':id')
  @RequirePermissions('crm.task.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(id);
  }
}
