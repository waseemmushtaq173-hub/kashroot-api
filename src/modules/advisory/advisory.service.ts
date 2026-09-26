import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AdvisoryCategory, FarmingAdvisory, PreferredLanguage, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';
import { QueryAdvisoryDto } from './dto/query-advisory.dto';

/** All spoken languages we pre-render advisory clips for. */
const ALL_LANGUAGES: PreferredLanguage[] = [
  PreferredLanguage.KASHMIRI,
  PreferredLanguage.URDU,
  PreferredLanguage.HINDI,
  PreferredLanguage.ENGLISH,
];

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

  /** Author one verified advisory, rendering its per-language spoken clips. */
  async createAdvisory(dto: CreateAdvisoryDto): Promise<FarmingAdvisory> {
    const audioPrompts = this.buildAudioPrompts(dto.topic, dto.content);
    return this.prisma.farmingAdvisory.create({
      data: {
        topic: dto.topic,
        category: dto.category,
        content: dto.content,
        applicableCrops: dto.applicableCrops,
        applicableRegions: dto.applicableRegions ?? [],
        source: dto.source,
        audioPrompts: audioPrompts as unknown as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * Public knowledge feed, newest first, filterable by category / crop / region.
   * Crop and region are matched against the advisory's `applicable*` arrays.
   */
  async findAdvisories(query: QueryAdvisoryDto): Promise<FarmingAdvisory[]> {
    const where: Prisma.FarmingAdvisoryWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.crop) where.applicableCrops = { has: query.crop };
    if (query.region) where.applicableRegions = { has: query.region };

    return this.prisma.farmingAdvisory.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
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

  // --- spoken clip synthesis (deterministic mock; Bhashini/Coqui later) ------

  /**
   * Render one pre-rendered spoken clip URL per language for an advisory. Keyed
   * by language + a hash of topic|content so identical advisories map to a
   * stable clip. Real implementation POSTs the text to Bhashini TTS per language.
   */
  private buildAudioPrompts(topic: string, content: string): Record<PreferredLanguage, string> {
    const prompts = {} as Record<PreferredLanguage, string>;
    for (const lang of ALL_LANGUAGES) {
      const clipId = createHash('sha1')
        .update(`${lang}:${topic}:${content}`)
        .digest('hex')
        .slice(0, 16);
      prompts[lang] = `https://cdn.mock.local/tts/advisory/${lang.toLowerCase()}/${clipId}.mp3`;
    }
    return prompts;
  }

  // --- seeding ----------------------------------------------------------

  /**
   * Seed the knowledge base with verified J&K horticulture advisories (Apple
   * scab spray schedule, Superstar/GA3 leaf-shine foliar, high-density planting,
   * soil nutrition). Idempotent: skips topics already present. Returns how many
   * new advisories were created.
   */
  async seedInitialAdvisories(): Promise<{ created: number; skipped: number }> {
    const seeds: CreateAdvisoryDto[] = [
      {
        topic: 'Apple Scab Spray Schedule (Green Tip to Pink Bud)',
        category: AdvisoryCategory.SPRAY_SCHEDULE,
        content:
          'Apple scab is the most damaging apple disease in Kashmir. Start protective ' +
          'sprays at green-tip: Mancozeb 75% WP at 3 g per litre of water. Repeat at ' +
          'pink-bud and petal-fall, and again after every heavy rain. Do not wait for ' +
          'spots to appear — scab spreads fastest in cool, wet spring weather.',
        applicableCrops: ['Apple'],
        applicableRegions: ['Sopore', 'Shopian', 'Baramulla', 'Anantnag'],
        source: 'SKUAST-K / J&K Horticulture Department',
      },
      {
        topic: 'Superstar (GA3) Leaf-Shine Foliar Spray',
        category: AdvisoryCategory.SPRAY_SCHEDULE,
        content:
          'For leaf vigour and fruit finish/shininess, spray genuine Superstar ' +
          '(Gibberellic Acid GA3 1.8%) at 1 to 1.5 ml per litre of water. Use only ' +
          'factory-verified bottles — counterfeit agency stock is common. Spray in the ' +
          'cool morning and never exceed the labelled dose.',
        applicableCrops: ['Apple'],
        applicableRegions: ['Sopore', 'Shopian'],
        source: 'FIL Industries product label / SKUAST-K',
      },
      {
        topic: 'San Jose Scale and Mite Control',
        category: AdvisoryCategory.DISEASE_PEST,
        content:
          'For San Jose scale, apply horticultural mineral oil (HMO) at the delayed ' +
          'dormant stage before bud burst. For European red mite in summer, use an ' +
          'approved miticide only when mites cross the threshold, and rotate chemistry ' +
          'to avoid resistance.',
        applicableCrops: ['Apple', 'Pear', 'Cherry'],
        applicableRegions: ['Baramulla', 'Anantnag'],
        source: 'SKUAST-K Division of Entomology',
      },
      {
        topic: 'High-Density Apple Planting (Modern Orchard)',
        category: AdvisoryCategory.MODERN_TECH,
        content:
          'High-density plantation on dwarfing rootstock (M9/MM106) with a trellis and ' +
          'drip irrigation gives earlier bearing and higher per-hectare yield than ' +
          'traditional orchards. Plant spindle-trained trees, maintain a central leader, ' +
          'and prune lightly every year to keep the canopy open to light.',
        applicableCrops: ['Apple'],
        applicableRegions: ['Shopian', 'Sopore'],
        source: 'SKUAST-K High-Density Plantation Programme',
      },
      {
        topic: 'Balanced Orchard Soil Nutrition',
        category: AdvisoryCategory.FERTILIZER_SOIL,
        content:
          'Apply farmyard manure in winter and split nitrogen (urea) into two doses — ' +
          'one before flowering and one after fruit set. Get a soil test every two to ' +
          'three years and add potash and micronutrients (boron, zinc) based on the ' +
          'report rather than guesswork. Over-use of nitrogen delays fruit colouring.',
        applicableCrops: ['Apple', 'Walnut'],
        applicableRegions: ['Sopore', 'Anantnag', 'Baramulla'],
        source: 'J&K Department of Agriculture / SKUAST-K',
      },
    ];

    let created = 0;
    let skipped = 0;
    for (const seed of seeds) {
      const exists = await this.prisma.farmingAdvisory.findFirst({
        where: { topic: seed.topic },
        select: { id: true },
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      await this.createAdvisory(seed);
      created += 1;
    }

    this.logger.log(`Advisory seed complete: ${created} created, ${skipped} skipped`);
    return { created, skipped };
  }
}
