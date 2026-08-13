import { Controller, Get } from '@nestjs/common';
import { QueryService } from './query.service';

@Controller('repos')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Get()
  async listPublic() {
    return this.queryService.listPublicLatest();
  }
}
