import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { ListingsService } from './listings.service';
import { ListingsQueryDto } from './dto/listings-query.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';

@ApiTags('Listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  /**
   * Browse and detail are the only unauthenticated routes in this controller.
   *
   * @Public() is required, not decorative: JwtAuthGuard is registered globally
   * as an APP_GUARD, so every route is authenticated unless it opts out. Without
   * it the buyer-facing marketplace returns 401 to anonymous visitors.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Public listing search — mapped to the buyer contract' })
  findAll(@Query() query: ListingsQueryDto) {
    return this.listingsService.findAll(query);
  }

  /**
   * NOTE: this route is declared after the collection route but before any
   * literal sibling, so `GET /listings/mine` (which the farmer dashboard calls)
   * currently resolves here with id="mine" and 404s. /mine is not implemented
   * yet; add it ABOVE this handler when it is, or Nest will never reach it.
   */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Single published listing' })
  findOne(@Param('id') id: string) {
    return this.listingsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a listing (farmer accounts only, created as DRAFT)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a listing — owner or admin only' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, user.sub, user.roles, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Archive a listing — owner or admin only' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.listingsService.remove(id, user.sub, user.roles);
  }
}
