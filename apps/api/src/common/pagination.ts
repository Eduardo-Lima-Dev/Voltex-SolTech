import type { Paginated, PaginationQuery } from '@voltex/shared';

export const toSkipTake = ({ page, pageSize }: PaginationQuery) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const toPaginated = <T>(
  data: T[],
  total: number,
  { page, pageSize }: PaginationQuery,
): Paginated<T> => ({
  data,
  meta: { page, pageSize, total },
});
