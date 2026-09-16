import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma, ReepayAdminRole, ReepayFeeEarningStatus } from "@prisma/client";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import type { FeeEarningsQueryDto } from "./dto/fee-earnings-query.dto";

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async onModuleInit() {
    if (!this.prisma.reepayAdminUser) {
      return;
    }

    await this.prisma.reepayAdminUser.upsert({
      where: { email: this.config.admin.email },
      update: { role: ReepayAdminRole.OWNER, isActive: true },
      create: {
        email: this.config.admin.email,
        role: ReepayAdminRole.OWNER,
        isActive: true
      }
    });
  }

  async getFeeEarnings(query: FeeEarningsQueryDto) {
    const where = this.buildFeeEarningsWhere(query);
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? { id: query.cursor } : undefined;

    const [admin, totals, totalsBySource, rows] = await Promise.all([
      this.prisma.reepayAdminUser.findUnique({ where: { email: this.config.admin.email } }),
      this.prisma.reepayFeeEarning.groupBy({
        by: ["currency"],
        where,
        _sum: { amount: true },
        _count: { _all: true }
      }),
      this.prisma.reepayFeeEarning.groupBy({
        by: ["sourceType", "currency"],
        where,
        _sum: { amount: true },
        _count: { _all: true }
      }),
      this.prisma.reepayFeeEarning.findMany({
        where,
        orderBy: [{ realizedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor, skip: 1 } : {}),
        include: {
          deposit: { select: { merchantReference: true, providerReference: true } },
          conversion: { select: { merchantReference: true, providerReference: true } },
          payout: { select: { merchantReference: true, providerReference: true } }
        }
      })
    ]);

    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit);

    return {
      admin: admin
        ? {
            id: admin.id,
            email: admin.email,
            role: admin.role
          }
        : undefined,
      summary: {
        totals: totals.map((total) => ({
          currency: total.currency,
          amount: total._sum.amount?.toFixed() ?? "0",
          count: total._count._all
        })),
        totalsBySource: totalsBySource.map((total) => ({
          sourceType: total.sourceType,
          currency: total.currency,
          amount: total._sum.amount?.toFixed() ?? "0",
          count: total._count._all
        }))
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        sourceType: entry.sourceType.toLowerCase(),
        sourceId: entry.sourceId,
        amount: entry.amount.toFixed(),
        currency: entry.currency,
        status: entry.status.toLowerCase(),
        realizedAt: entry.realizedAt.toISOString(),
        reference:
          entry.deposit?.merchantReference ??
          entry.conversion?.merchantReference ??
          entry.payout?.merchantReference,
        providerReference:
          entry.deposit?.providerReference ??
          entry.conversion?.providerReference ??
          entry.payout?.providerReference
      })),
      page: {
        limit,
        hasMore,
        nextCursor: hasMore ? entries.at(-1)?.id : undefined
      }
    };
  }

  private buildFeeEarningsWhere(query: FeeEarningsQueryDto): Prisma.ReepayFeeEarningWhereInput {
    return {
      status: ReepayFeeEarningStatus.REALIZED,
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.from || query.to
        ? {
            realizedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {})
    };
  }
}
