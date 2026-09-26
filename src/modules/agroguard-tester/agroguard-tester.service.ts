import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { InspectionVerdict, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** Languages we pre-render spoken dosage instructions in (mirrors PreferredLanguage). */
const SPOKEN_LANGUAGES = ['KASHMIRI', 'URDU', 'HINDI', 'ENGLISH'] as const;

/** Verdict boundary: at/above this the bottle is treated as authentic. */
const GENUINE_THRESHOLD = 0.7;

/**
 * Deduction weights per detected packaging discrepancy. A pristine bottle
 * scores 1.0; each flaw chips away confidence. Tuned so the two classic
 * counterfeit tells (fake logo + unlisted batch) alone push a sample under the
 * genuine threshold.
 */
const WEIGHTS = {
  logoMismatch: 0.35,
  hologramMismatch: 0.3,
  unlistedBatch: 0.2,
  missingSeal: 0.1,
  perFontAnomaly: 0.05,
} as const;

export interface InspectAgencyProductInput {
  /** Local dealer/shop the sample was bought from. */
  agencyName: string;
  /** Brand printed on the bottle, matched against the golden reference. */
  productBrand: string;
  scannedBatchNo?: string;
  /** URL of the scan, if the client already uploaded it. */
  scannedBottleImageUrl?: string;
  /** Raw uploaded scan; simulated-stored when no URL is supplied. */
  bottleImage?: Express.Multer.File;
  /** Hologram pattern read off the bottle by the scan pipeline. */
  observedHologramPattern?: string;
  /** Did the printed logo visually match the factory logo? */
  logoMatchesFactory?: boolean;
  /** Was the tamper/quality seal present? */
  sealPresent?: boolean;
  /** Font/typography anomalies the detector flagged (labels). */
  fontAnomalies?: string[];
}

export interface DiscrepancyReport {
  logoMismatch: boolean;
  hologramMismatch: boolean;
  unlistedBatch: boolean;
  missingSeal: boolean;
  fontMismatches: string[];
}

@Injectable()
export class AgroGuardTesterService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the tester profile for an authenticated user, or 404. */
  async resolveTesterProfileId(userId: string): Promise<string> {
    const profile = await this.prisma.testerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('Tester profile not found for this user.');
    }
    return profile.id;
  }

  /**
   * Compare a scanned agency bottle against the industry golden reference for
   * its brand, score the packaging discrepancies, and persist the verdict.
   * Always returns the AUTHENTIC manufacturer dosage (so the tester can correct
   * the farmer) alongside the genuine/counterfeit call.
   */
  async compareAgencyProduct(
    testerProfileId: string,
    input: InspectAgencyProductInput,
  ) {
    const reference = await this.prisma.industryGoldenReference.findUnique({
      where: { brandName: input.productBrand },
    });
    if (!reference) {
      throw new NotFoundException(
        `No industry golden reference on file for brand "${input.productBrand}".`,
      );
    }

    const scannedBottleImageUrl =
      input.scannedBottleImageUrl ??
      (input.bottleImage
        ? this.simulateBottleUpload(testerProfileId, input.bottleImage)
        : undefined);
    if (!scannedBottleImageUrl) {
      throw new BadRequestException(
        'A scanned bottle image (upload or URL) is required.',
      );
    }

    // Derive the discrepancy report from the scan signals vs the golden ref.
    const unlistedBatch =
      !input.scannedBatchNo ||
      !input.scannedBatchNo.startsWith(reference.factoryBatchPrefix);
    const hologramMismatch =
      input.observedHologramPattern !== undefined &&
      input.observedHologramPattern !== reference.factoryHologramPattern;
    const logoMismatch = input.logoMatchesFactory === false;
    const missingSeal = input.sealPresent === false;
    const fontMismatches = input.fontAnomalies ?? [];

    const report: DiscrepancyReport = {
      logoMismatch,
      hologramMismatch,
      unlistedBatch,
      missingSeal,
      fontMismatches,
    };

    const matchConfidence = this.scoreConfidence(report);
    const verdict =
      matchConfidence >= GENUINE_THRESHOLD
        ? InspectionVerdict.GENUINE_FACTORY
        : InspectionVerdict.SUSPICIOUS_COUNTERFEIT;

    const inspection = await this.prisma.agencyPesticideInspection.create({
      data: {
        testerProfileId,
        agencyName: input.agencyName,
        productBrand: input.productBrand,
        scannedBatchNo: input.scannedBatchNo ?? null,
        scannedBottleImageUrl,
        verdict,
        matchConfidence,
        discrepancyReport: report as unknown as Prisma.InputJsonObject,
      },
    });

    return {
      inspectionId: inspection.id,
      verdict,
      matchConfidence,
      brand: reference.brandName,
      manufacturerName: reference.manufacturerName,
      discrepancyReport: report,
      // Authentic factory guidance — shown regardless of verdict.
      verifiedInstructions: {
        chemicalComposition: reference.chemicalComposition,
        targetCrops: reference.targetCrops,
        dosageInstructions: reference.dosageInstructions,
        audioPrompts: reference.audioPrompts,
      },
    };
  }

  /** Past agency audits for a tester, newest first. */
  async getInspectionHistory(testerProfileId: string) {
    return this.prisma.agencyPesticideInspection.findMany({
      where: { testerProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Seed the authentic baseline for the apple spray "Superstar". Idempotent
   * upsert keyed on the unique brandName, so it is safe to run repeatedly.
   */
  async seedIndustryGoldenReferences() {
    const superstar = {
      brandName: 'Superstar',
      manufacturerName: 'FIL Industries',
      chemicalComposition:
        'Gibberellic Acid (GA3) 1.8% + micronutrient blend (foliar grade)',
      targetCrops: 'Apple',
      factoryBatchPrefix: 'FIL-SS-',
      factoryHologramPattern: 'FIL-HOLO-3D-STAR',
      goldenImageUrl: 'https://cdn.mock.local/agroguard/golden/superstar.png',
      dosageInstructions:
        'Spray for leaf vigour and fruit finish/shininess, 1-1.5 ml/L of water.',
    };

    const audioPrompts = this.buildDosageAudioPrompts(
      superstar.brandName,
      superstar.dosageInstructions,
    );

    return this.prisma.industryGoldenReference.upsert({
      where: { brandName: superstar.brandName },
      update: { ...superstar, audioPrompts },
      create: { ...superstar, audioPrompts },
    });
  }

  // ─── internals ─────────────────────────────────────────────────────

  /** Confidence = 1 minus weighted discrepancies, clamped to [0,1], 2 dp. */
  private scoreConfidence(report: DiscrepancyReport): number {
    let deduction = 0;
    if (report.logoMismatch) deduction += WEIGHTS.logoMismatch;
    if (report.hologramMismatch) deduction += WEIGHTS.hologramMismatch;
    if (report.unlistedBatch) deduction += WEIGHTS.unlistedBatch;
    if (report.missingSeal) deduction += WEIGHTS.missingSeal;
    deduction += report.fontMismatches.length * WEIGHTS.perFontAnomaly;

    const confidence = Math.max(0, Math.min(1, 1 - deduction));
    return Math.round(confidence * 100) / 100;
  }

  /** Deterministic per-language spoken dosage clip URLs (simulated TTS). */
  private buildDosageAudioPrompts(
    brand: string,
    dosage: string,
  ): Record<string, string> {
    const prompts: Record<string, string> = {};
    for (const lang of SPOKEN_LANGUAGES) {
      const hash = createHash('sha1')
        .update(`${lang}|${brand}|${dosage}`)
        .digest('hex')
        .slice(0, 12);
      prompts[lang] =
        `https://cdn.mock.local/tts/agroguard/${lang.toLowerCase()}/${brand.toLowerCase()}-${hash}.mp3`;
    }
    return prompts;
  }

  /** Mock object-storage upload for a scanned bottle — no real network I/O. */
  private simulateBottleUpload(
    testerProfileId: string,
    file: Express.Multer.File,
  ): string {
    const safeName = (file.originalname ?? 'bottle').replace(/[^\w.-]/g, '_');
    return `https://s3.mock.local/agroguard/${testerProfileId}/${randomUUID()}-${safeName}`;
  }
}
