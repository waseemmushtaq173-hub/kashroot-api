import { Injectable, Logger } from '@nestjs/common';
import { AdvisoryCategory, FarmingAdvisory, PreferredLanguage, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';
import { QueryAdvisoryDto } from './dto/query-advisory.dto';

/**
 * Keyword → category hints, used both to route free-text farmer questions to the
 * right advisory bucket and to boost scoring. Includes Hindi/Urdu/Kashmiri
 * transliterations a voice transcript may carry (bimari = disease, dawa =
 * medicine/spray, koshur = Kashmiri).
 */
const CATEGORY_KEYWORDS: Record<AdvisoryCategory, string[]> = {
  [AdvisoryCategory.SPRAY_SCHEDULE]: ['spray', 'schedule', 'dawa', 'fungicide', 'mancozeb'],
  [AdvisoryCategory.DISEASE_PEST]: [
    'disease',
    'scab',
    'pest',
    'mite',
    'aphid',
    'bimari',
    'insect',
    'fungus',
  ],
  [AdvisoryCategory.FERTILIZER_SOIL]: ['fertilizer', 'fertiliser', 'urea', 'soil', 'nutrient', 'manure'],
  [AdvisoryCategory.MODERN_TECH]: ['prune', 'pruning', 'high-density', 'trellis', 'drip', 'technology'],
  [AdvisoryCategory.GOV_ALERT]: ['alert', 'warning', 'advisory', 'outbreak', 'notice'],
};

/**
 * Spoken Agronomy Knowledge Base.
 *
 * Owns the verified farming advisories surfaced in the Farmer Portal knowledge
 * feed AND grounded into the Voice AI assistant. Visual text stays English; each
 * advisory carries pre-rendered per-language TTS clip URLs so non-readers can
 * listen. Clip synthesis is the same deterministic mock as the rest of the voice
 * pipeline (swapped for Bhashini/Coqui behind this signature later).
 */
@Injectable()
export class AdvisoryService {
  private readonly logger = new Logger(AdvisoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Author one verified advisory. No synthetic audio prompts are generated. */
  async createAdvisory(dto: CreateAdvisoryDto): Promise<FarmingAdvisory> {
    return this.prisma.farmingAdvisory.create({
      data: {
        topic: dto.topic,
        category: dto.category,
        content: dto.content,
        applicableCrops: dto.applicableCrops,
        applicableRegions: dto.applicableRegions ?? [],
        isGovVerified: dto.isGovVerified ?? false,
        sourceOrganization: dto.sourceOrganization,
        sourceUrl: dto.sourceUrl ?? null,
        audioPrompts: null,
      },
    });
  }

  /**
   * Upsert a government advisory keyed by topic (used by the live gov-sync job so
   * a re-run refreshes the same alert rather than duplicating it). Always marked
   * `isGovVerified`. Returns whether the row was newly created.
   */
  async upsertGovAdvisory(input: {
    topic: string;
    category: AdvisoryCategory;
    content: string;
    applicableCrops: string[];
    applicableRegions: string[];
    sourceOrganization: string;
    sourceUrl?: string | null;
  }): Promise<{ advisory: FarmingAdvisory; created: boolean }> {
    const existing = await this.prisma.farmingAdvisory.findFirst({
      where: { topic: input.topic },
      select: { id: true },
    });

    const data = {
      category: input.category,
      content: input.content,
      applicableCrops: input.applicableCrops,
      applicableRegions: input.applicableRegions,
      isGovVerified: true,
      sourceOrganization: input.sourceOrganization,
      sourceUrl: input.sourceUrl ?? null,
      audioPrompts: null,
    };

    if (existing) {
      const advisory = await this.prisma.farmingAdvisory.update({
        where: { id: existing.id },
        data,
      });
      return { advisory, created: false };
    }

    const advisory = await this.prisma.farmingAdvisory.create({
      data: { topic: input.topic, ...data },
    });
    return { advisory, created: true };
  }

  /**
   * Public knowledge feed. Filterable by category / crop / region and ordered so
   * verified government advisories surface first, then newest — the trust-and-
   * freshness ordering the Farmer Portal feed relies on.
   */
  async findAdvisories(query: QueryAdvisoryDto): Promise<FarmingAdvisory[]> {
    const where: Prisma.FarmingAdvisoryWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.crop) where.applicableCrops = { has: query.crop };
    if (query.region) where.applicableRegions = { has: query.region };

    return this.prisma.farmingAdvisory.findMany({
      where,
      orderBy: [{ isGovVerified: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  /**
   * Best-match advisory for a free-text (voice) farmer question. Scores every
   * advisory by keyword overlap across topic + content + crops + category hints,
   * optionally constrained to a crop, and returns the single strongest match (or
   * null when nothing meaningfully matches). This is the grounding call the AI
   * assistant makes before speaking agronomy guidance.
   */
  async searchRelevantAdvisory(
    query: string,
    regionId?: string | null,
    crop?: string | null,
  ): Promise<FarmingAdvisory | null> {
    const candidates = await this.prisma.farmingAdvisory.findMany({
      where: crop ? { applicableCrops: { has: crop } } : {},
    });
    if (candidates.length === 0) return null;

    const tokens = this.tokenize(query);
    if (tokens.length === 0) return null;

    let best: { advisory: FarmingAdvisory; score: number } | null = null;
    for (const advisory of candidates) {
      const score = this.scoreAdvisory(advisory, tokens);
      if (score > 0 && (!best || score > best.score)) {
        best = { advisory, score };
      }
    }
    return best?.advisory ?? null;
  }

  // --- scoring internals -------------------------------------------------

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  private scoreAdvisory(advisory: FarmingAdvisory, tokens: string[]): number {
    const haystack = `${advisory.topic} ${advisory.content} ${advisory.applicableCrops.join(' ')}`.toLowerCase();
    const categoryHints = CATEGORY_KEYWORDS[advisory.category] ?? [];

    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 2;
      if (categoryHints.includes(token)) score += 3; // strong signal on the bucket
    }
    return score;
  }
}

