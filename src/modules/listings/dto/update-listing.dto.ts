import { PartialType } from '@nestjs/swagger';
import { CreateListingDto } from './create-listing.dto';

/**
 * Body accepted by PATCH /listings/:id.
 *
 * Every field optional, same names and same translation rules as creation, so
 * the edit form can PATCH exactly what it POSTs.
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {}
