import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('listings')
export class ListingsController {
  @Get()
  findAll(@Query() query: any) {
    // GET /listings?region=...&category=...&page=...
    return { message: 'listings endpoint - wire up ListingsService' };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return { message: `listing ${id}` };
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return { message: 'create listing' };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return { message: `update listing ${id}` };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return { message: `delete listing ${id}` };
  }
}