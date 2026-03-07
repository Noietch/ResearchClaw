import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  try {
    const papers = await prisma.paper.findMany({
      include: {
        tags: { include: { tag: true } },
        links: true,
        readingNotes: true,
      },
      orderBy: [{ lastReadAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 5,
    });
    console.log('Found papers:', papers.length);
    console.log('First paper:', papers[0]?.shortId, papers[0]?.title?.slice(0, 50));
  } catch (err) {
    console.error('Error:', err);
  }
}

main().finally(() => prisma.$disconnect());
