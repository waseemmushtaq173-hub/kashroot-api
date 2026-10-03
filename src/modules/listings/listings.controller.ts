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
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { ListingsService } from './listings.service';
import { ListingsQueryDto } from './dto/listings-query.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';
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
   * Declared BEFORE @Get(':id') deliberately. Nest matches routes in declaration
   * order and both are single-segment paths under /listings, so if this handler
   * sat below the parameterised one, `GET /listings/mine` would be captured as
   * id="mine" and 404 on a malformed uuid. Any future literal sibling (/count,
   * /stats) has to be declared above @Get(':id') for the same reason.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('mine')
  @ApiOperation({ summary: "The calling farmer's own listings, drafts included" })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyListingsQueryDto,
  ) {
    return this.listingsService.findMine(user.sub, query);
  }

  /**
   * Public read, but identity-aware.
   *
   * @Public() bypasses the global JwtAuthGuard so anonymous callers get through;
   * OptionalJwtAuthGuard then attaches the caller's identity if they happen to
   * present a valid token. Both are needed: without @Public() the global guard
   * rejects anonymous visitors, and without the optional guard the owner's token
   * is ignored and they cannot read their own draft.
   *
   * A non-public status therefore returns 200 for the owner or an admin and 404
   * for everyone else — the service makes that decision, not the guard.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({
    summary: 'Single listing — public statuses, or any status for its owner/admin',
  })
  findOne(
    @Param('id') id: string,
    @CurrentUser() viewer?: AuthenticatedUser,
  ) {
    return this.listingsService.findOne(id, viewer);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a listing (farmer accounts only, created as DRAFT)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user.sub, dto);
  }

  /**
   * Publish and unpublish take no body — the client calls them with none
   * (lib/api/farmer.ts:66,70), so there is nothing to validate.
   *
   * These are two-segment paths, so unlike /mine they cannot be shadowed by
   * @Patch(':id') below regardless of declaration order.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish a listing — owner or admin only (no KYC gate yet)' })
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.listingsService.publish(id, user.sub, user.roles);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id/unpublish')
  @ApiOperation({ summary: 'Return a listing to draft — owner or admin only' })
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.listingsService.unpublish(id, user.sub, user.roles);
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
