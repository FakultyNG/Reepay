import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class TransactionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getTransaction(id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });

    if (!transaction) {
      throw new NotFoundException("Transaction not found");
    }

    return this.toTransactionResponse(transaction);
  }

  async listTransactions(customerExternalId: string, limit = 25, cursor?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const customer = await this.prisma.customer.findUnique({ where: { externalId: customerExternalId } });

    if (!customer) {
      return {
        items: [],
        nextCursor: undefined
      };
    }

    const rows = await this.prisma.transaction.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    const items = rows.slice(0, take);

    return {
      items: items.map((transaction) => this.toTransactionResponse(transaction)),
      nextCursor: rows.length > take ? rows[take]?.id : undefined
    };
  }

  private toTransactionResponse(transaction: Awaited<ReturnType<PrismaService["transaction"]["findUnique"]>> & {}) {
    return {
      id: transaction.id,
      type: transaction.type.toLowerCase(),
      status: transaction.status.toLowerCase(),
      amount: transaction.amount.toFixed(),
      currency: transaction.currency,
      reference: transaction.merchantReference ?? undefined,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString()
    };
  }
}
