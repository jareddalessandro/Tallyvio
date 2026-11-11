import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Checkbox,
  Collapse,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { randomId, useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconCreditCard, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api';
import { CategoryBadge } from '../components/CategoryColor';
import CategorySelect from '../components/CategorySelect';
import {
  confirmDelete,
  Editable,
  EmptyState,
  Figure,
  PageHeader,
  RowActions,
  SectionCard,
  SortableTh,
  StatCard,
  useAppMutation,
  type SortDir,
} from '../components/common';
import { ExpenseDonut } from '../components/ExpenseDonut';
import { DEDUCTION_PRESETS, IncomeBreakdownCard, PaycheckWaterfall, stageOf } from '../components/Paycheck';
import { DEDUCTION_TYPE_LABELS, FREQUENCY_LABELS, money, percent } from '../format';
import type { BudgetItem, BudgetItemInput, CategoryKind, Deduction, DeductionType, Frequency } from '../types';

const MONTHLY_FACTOR: Record<Frequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

type Editing = { kind: CategoryKind; item: BudgetItem | null; paycheck?: boolean } | null;

type SortKey = 'name' | 'category' | 'amount' | 'monthly';
type Sort = { key: SortKey; dir: SortDir };
type Sorts = Record<CategoryKind, Sort>;

const DEFAULT_SORTS: Sorts = { income: { key: 'name', dir: 'asc' }, expense: { key: 'name', dir: 'asc' } };
const SORT_STORAGE_KEY = 'tallyvio.budget-sort';

// The chosen sort is a per-browser convenience; storage can be unavailable, so fall back quietly.
function loadSorts(): Sorts {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? 'null');
    if (saved?.income?.key && saved?.expense?.key) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_SORTS;
}

function saveSorts(sorts: Sorts) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sorts));
  } catch {
    /* ignore */
  }
}

const byName = (a: BudgetItem, b: BudgetItem) => a.name.localeCompare(b.name);
const COMPARE: Record<SortKey, (a: BudgetItem, b: BudgetItem) => number> = {
  name: byName,
  category: (a, b) => a.category.name.localeCompare(b.category.name) || byName(a, b),
  amount: (a, b) => a.amount - b.amount || byName(a, b),
  monthly: (a, b) => a.monthly_amount - b.monthly_amount || byName(a, b),
};

function sortItems(rows: BudgetItem[], { key, dir }: Sort) {
  const sorted = [...rows].sort(COMPARE[key]);
  return dir === 'asc' ? sorted : sorted.reverse();
}

/** "Gross $4,600.00 · Tax $900.00 · Retirement $510.00", per paycheck, grouped by type. */
function paycheckSummary(item: BudgetItem) {
  const byType = new Map<DeductionType, number>();
  for (const d of item.deductions) byType.set(d.type, (byType.get(d.type) ?? 0) + d.amount);
  return [`Gross ${money(item.gross_amount)}`, ...[...byType].map(([t, a]) => `${DEDUCTION_TYPE_LABELS[t]} ${money(a)}`)].join(
    ' · ',
  );
}

export default function BudgetPage() {
  const [editing, setEditing] = useState<Editing>(null);
  const [sorts, setSorts] = useState<Sorts>(loadSorts);
  const { data: items = [], isLoading } = useQuery({ queryKey: ['budget-items'], queryFn: api.budgetItems });
  const { data: summary } = useQuery({ queryKey: ['budget-summary'], queryFn: api.budgetSummary });
  const remove = useAppMutation((id: number) => api.deleteBudgetItem(id), 'Budget item deleted');
  const deleteItem = (item: BudgetItem) => confirmDelete(`"${item.name}"`, () => remove.mutate(item.id));
  // Phones get the items as an expandable list instead of the table.
  const phone = useMediaQuery('(max-width: 36em)') ?? false;

  const income = items.filter((i) => i.category.kind === 'income');
  const expenses = items.filter((i) => i.category.kind === 'expense');
  const expenseByCategory = (summary?.by_category ?? [])
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ name: c.name, color: c.color, amount: c.monthly_amount }));
  const savingsRate = summary && summary.monthly_income > 0 ? summary.monthly_surplus / summary.monthly_income : null;

  // Clicking the active column flips it; a new column starts A→Z for text, largest first for amounts.
  const sortBy = (kind: CategoryKind, key: SortKey) => {
    const current = sorts[kind];
    const dir: SortDir =
      current.key === key ? (current.dir === 'asc' ? 'desc' : 'asc') : key === 'amount' || key === 'monthly' ? 'desc' : 'asc';
    const next = { ...sorts, [kind]: { key, dir } };
    setSorts(next);
    saveSorts(next);
  };

  const itemTable = (rows: BudgetItem[], kind: CategoryKind) => {
    const sort = sorts[kind];
    const header = (key: SortKey, label: string, align?: 'right', className?: string) => (
      <SortableTh
        label={label}
        align={align}
        className={className}
        active={sort.key === key}
        dir={sort.dir}
        onSort={() => sortBy(kind, key)}
      />
    );
    return rows.length === 0 ? (
      <EmptyState
        message={kind === 'income' ? 'No expected income yet.' : 'No expected expenses yet.'}
        action={
          <Group gap="xs">
            {kind === 'income' && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => setEditing({ kind, item: null, paycheck: true })}
              >
                Add paycheck
              </Button>
            )}
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ kind, item: null })}>
              {kind === 'income' ? 'Add other income' : 'Add expense'}
            </Button>
          </Group>
        }
      />
    ) : phone ? (
      <BudgetItemList
        rows={sortItems(rows, sort)}
        kind={kind}
        sort={sort}
        onSort={(next) => {
          const all = { ...sorts, [kind]: next };
          setSorts(all);
          saveSorts(all);
        }}
        onEdit={(item) => setEditing({ kind, item })}
        onDelete={deleteItem}
      />
    ) : (
      <Table.ScrollContainer minWidth={560} className="phone-fit">
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              {header('name', 'Name')}
              {header('category', 'Category', undefined, 'hide-xs')}
              {header('amount', kind === 'income' ? 'Take-home' : 'Amount', 'right', 'hide-xs')}
              <Table.Th className="hide-xs">How often</Table.Th>
              {header('monthly', 'Per month', 'right')}
              <Table.Th w={70} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortItems(rows, sort).map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{item.name}</Text>
                    {item.paid_by_card && (
                      <Tooltip label="Paid by credit card. In a statement month it's compared with card payments.">
                        <IconCreditCard size={14} color="var(--mantine-color-dimmed)" aria-label="Paid by card" />
                      </Tooltip>
                    )}
                  </Group>
                  {item.gross_amount != null && (
                    <Text size="xs" c="dimmed" className="num">
                      {paycheckSummary(item)}
                    </Text>
                  )}
                  {item.notes && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {item.notes}
                    </Text>
                  )}
                  <Stack className="show-xs" gap={4} mt={4}>
                    <Text size="xs" c="dimmed" className="num">
                      {money(item.amount)} · {FREQUENCY_LABELS[item.frequency]}
                    </Text>
                    <CategoryBadge category={item.category} />
                  </Stack>
                </Table.Td>
                <Table.Td className="hide-xs">
                  <CategoryBadge category={item.category} />
                </Table.Td>
                <Table.Td ta="right" className="num hide-xs">
                  {money(item.amount)}
                </Table.Td>
                <Table.Td className="hide-xs">{FREQUENCY_LABELS[item.frequency]}</Table.Td>
                <Table.Td ta="right" className="num" fw={500}>
                  {money(item.monthly_amount)}
                </Table.Td>
                <Table.Td>
                  <RowActions
                    label={`Actions for ${item.name}`}
                    actions={[
                      { label: 'Edit', icon: <IconPencil size={16} />, onClick: () => setEditing({ kind, item }) },
                      { label: 'Delete', icon: <IconTrash size={16} />, color: 'red', onClick: () => deleteItem(item) },
                    ]}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th>Total</Table.Th>
              <Table.Th colSpan={3} className="hide-xs" />
              <Table.Th ta="right" className="num">
                {money(rows.reduce((sum, r) => sum + r.monthly_amount, 0))}
              </Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
    );
  };

  return (
    <>
      <PageHeader
        title="Budget"
        description="What you expect to earn and spend. Everything is converted to a monthly amount."
        actions={
          <Editable>
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ kind: 'income', item: null })}>
              Add income
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ kind: 'expense', item: null })}>
              Add expense
            </Button>
          </Editable>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing={{ base: 'sm', sm: 'lg' }} mb="xl">
        <StatCard
          label="Monthly income"
          value={money(summary?.monthly_income)}
          footer={summary?.paycheck ? `Take-home · ${money(summary.paycheck.annual_gross / 12)} gross pay` : undefined}
        />
        <StatCard label="Monthly expenses" value={money(summary?.monthly_expenses)} />
        <StatCard
          label="Monthly surplus"
          value={
            <span className={summary && summary.monthly_surplus < 0 ? 'delta-down' : undefined}>
              {money(summary?.monthly_surplus)}
            </span>
          }
          footer={summary && summary.monthly_surplus < 0 ? 'Planned spending exceeds income' : 'Left over each month'}
        />
        <StatCard
          label="Savings rate"
          value={savingsRate == null ? '—' : percent(savingsRate)}
          footer="Surplus as a share of income"
        />
      </SimpleGrid>

      {/* Income on the left, expenses on the right. Equal columns so the expenses table fits. */}
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Stack gap="lg">
            <SectionCard
              title="Expected income"
              actions={
                income.length > 0 && (
                  <Editable>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlus size={14} />}
                      onClick={() => setEditing({ kind: 'income', item: null, paycheck: true })}
                    >
                      Add paycheck
                    </Button>
                  </Editable>
                )
              }
            >
              {isLoading ? null : itemTable(income, 'income')}
            </SectionCard>
            {summary?.paycheck && (
              <SectionCard title="Income breakdown">
                <IncomeBreakdownCard combined={summary.paycheck} items={summary.paycheck_items} />
              </SectionCard>
            )}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Stack gap="lg">
            <SectionCard title="Monthly expenses by category">
              {expenseByCategory.length === 0 ? (
                <EmptyState message="Add expected expenses to see where the money goes." />
              ) : (
                <ExpenseDonut categories={expenseByCategory} />
              )}
            </SectionCard>
            <SectionCard title="Expected expenses">{isLoading ? null : itemTable(expenses, 'expense')}</SectionCard>
          </Stack>
        </Grid.Col>
      </Grid>

      <BudgetItemModal editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Sort choices for phones, where the table's sortable headers aren't shown. */
const PHONE_SORTS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'monthly-desc', label: 'Largest per month' },
  { value: 'monthly-asc', label: 'Smallest per month' },
  { value: 'category-asc', label: 'Category A–Z' },
];

/**
 * Phones: budget items as a list, like the Investments holdings. A row shows the name and the monthly
 * amount; tapping it opens the rest (amount and how often, category, notes, and for a paycheck its gross
 * pay and deductions per paycheck) with Edit and Delete.
 */
function BudgetItemList({
  rows,
  kind,
  sort,
  onSort,
  onEdit,
  onDelete,
}: {
  rows: BudgetItem[];
  kind: CategoryKind;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onEdit: (item: BudgetItem) => void;
  onDelete: (item: BudgetItem) => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // The per-payment "amount" sort has no phone choice; it shows as the per-month one, which is closest.
  const sortValue = `${sort.key === 'amount' ? 'monthly' : sort.key}-${sort.dir}`;

  return (
    <Stack gap={2}>
      <Select
        aria-label={kind === 'income' ? 'Sort income' : 'Sort expenses'}
        data={PHONE_SORTS}
        value={PHONE_SORTS.some((o) => o.value === sortValue) ? sortValue : 'name-asc'}
        onChange={(v) => {
          if (!v) return;
          const [key, dir] = v.split('-') as [SortKey, SortDir];
          onSort({ key, dir });
        }}
        allowDeselect={false}
        mb="xs"
      />
      {rows.map((item) => {
        const isOpen = open.has(item.id);
        const byType = new Map<DeductionType, number>();
        for (const d of item.deductions) byType.set(d.type, (byType.get(d.type) ?? 0) + d.amount);
        // Gross minus the entered deductions minus take-home: what the deductions don't account for. Named
        // like the Income breakdown card: mostly withholding when no taxes are entered.
        const unitemized =
          item.gross_amount == null
            ? 0
            : Math.round((item.gross_amount - item.deductions.reduce((t, d) => t + d.amount, 0) - item.amount) * 100) / 100;
        return (
          <div key={item.id} className="expand-row" data-open={isOpen || undefined}>
            <UnstyledButton
              className="expand-row-head"
              onClick={() => toggle(item.id)}
              aria-expanded={isOpen}
              aria-controls={`budget-item-${item.id}`}
            >
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>
                    {item.name}
                  </Text>
                  {item.paid_by_card && <IconCreditCard size={14} color="var(--mantine-color-dimmed)" aria-label="Paid by card" />}
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={600} className="num">
                    {money(item.monthly_amount)}
                  </Text>
                  <IconChevronDown size={16} className="expand-chevron" aria-hidden />
                </Group>
              </Group>
            </UnstyledButton>
            <Collapse in={isOpen}>
              <div className="expand-details" id={`budget-item-${item.id}`}>
                <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
                  <Figure label={kind === 'income' ? 'Take-home' : 'Amount'}>{money(item.amount)}</Figure>
                  <Figure label="How often">{FREQUENCY_LABELS[item.frequency]}</Figure>
                </SimpleGrid>
                <Text className="label-sm" mt="sm">
                  Category
                </Text>
                <Group mt={4}>
                  <CategoryBadge category={item.category} />
                </Group>
                {item.gross_amount != null && (
                  // Per paycheck, like the form: gross pay, each kind of deduction, then what's deposited.
                  <>
                    <Text className="label-sm" mt="sm" mb={4}>
                      Per paycheck
                    </Text>
                    <Stack gap={2}>
                      <PaycheckLine label="Gross pay" amount={item.gross_amount} />
                      {[...byType].map(([type, amount]) => (
                        <PaycheckLine key={type} label={DEDUCTION_TYPE_LABELS[type]} amount={-amount} />
                      ))}
                      {unitemized !== 0 && (
                        <PaycheckLine label={byType.has('tax') ? 'Not itemized' : 'Taxes or not itemized'} amount={-unitemized} />
                      )}
                      <PaycheckLine label="Take-home" amount={item.amount} strong />
                    </Stack>
                  </>
                )}
                {item.paid_by_card && (
                  <Text size="sm" c="dimmed" mt="sm">
                    Paid by credit card: in a statement month it&apos;s compared with card payments.
                  </Text>
                )}
                {item.notes && (
                  <Text size="sm" c="dimmed" mt="sm">
                    {item.notes}
                  </Text>
                )}
                <Editable>
                  <Group gap="xs" mt="sm" wrap="nowrap">
                    <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => onEdit(item)} style={{ flex: 1 }}>
                      Edit
                    </Button>
                    <ActionIcon variant="default" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}>
                      <IconTrash size={16} color="var(--delta-down)" />
                    </ActionIcon>
                  </Group>
                </Editable>
              </div>
            </Collapse>
          </div>
        );
      })}
      <Group justify="space-between" wrap="nowrap" className="list-total" mt="xs">
        <Text fw={700}>Total per month</Text>
        <Text fw={700} className="num">
          {money(rows.reduce((sum, r) => sum + r.monthly_amount, 0))}
        </Text>
      </Group>
    </Stack>
  );
}

/** One line of a paycheck's breakdown; deductions come in negative. */
function PaycheckLine({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c={strong ? undefined : 'dimmed'} fw={strong ? 600 : undefined}>
        {label}
      </Text>
      <Text size="sm" className="num" fw={strong ? 600 : 500}>
        {amount < 0 ? `−${money(-amount)}` : money(amount)}
      </Text>
    </Group>
  );
}

function BudgetItemModal({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  return (
    <Modal
      opened={editing !== null}
      onClose={onClose}
      size={editing?.kind === 'income' ? 'xl' : 'md'}
      title={editing ? `${editing.item ? 'Edit' : 'Add'} ${isPaycheck(editing) ? 'paycheck' : `expected ${editing.kind}`}` : ''}
    >
      {/* Keyed so the form resets each time the modal opens with a different item. */}
      {editing && <BudgetItemForm key={editing.item?.id ?? `new-${editing.kind}-${editing.paycheck ? 'paycheck' : 'plain'}`} editing={editing} onDone={onClose} />}
    </Modal>
  );
}

const isPaycheck = (editing: NonNullable<Editing>) => !!editing.paycheck || editing.item?.gross_amount != null;

type DeductionRow = Omit<Deduction, 'amount'> & { key: string; amount: number | '' };

const num = (v: number | '') => (typeof v === 'number' ? v : 0);

function BudgetItemForm({ editing, onDone }: { editing: NonNullable<Editing>; onDone: () => void }) {
  const { item, kind } = editing;
  const form = useForm({
    initialValues: {
      name: item?.name ?? '',
      category_id: item?.category.id ?? (null as number | null),
      amount: item?.amount ?? ('' as number | ''),
      frequency: item?.frequency ?? ((editing.paycheck ? 'biweekly' : 'monthly') as Frequency),
      notes: item?.notes ?? '',
      paid_by_card: item?.paid_by_card ?? false,
      breakdown: isPaycheck(editing),
      gross_amount: item?.gross_amount ?? ('' as number | ''),
      deductions: (item?.deductions ?? []).map((d): DeductionRow => ({ ...d, key: randomId() })),
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Required'),
      category_id: (v) => (v ? null : 'Required'),
      amount: (v, values) => {
        if (!(typeof v === 'number' && v > 0)) return 'Enter an amount greater than 0';
        if (values.breakdown && typeof values.gross_amount === 'number' && v > values.gross_amount)
          return "Take-home can't be more than gross pay";
        return null;
      },
      gross_amount: (v, values) => (!values.breakdown || (typeof v === 'number' && v > 0) ? null : 'Enter gross pay'),
      deductions: {
        name: (v, values) => (!values.breakdown || v.trim() ? null : 'Name it'),
        amount: (v, values) => (!values.breakdown || (typeof v === 'number' && v > 0) ? null : 'Enter amount'),
      },
    },
  });
  const save = useAppMutation(
    (body: BudgetItemInput) => (item ? api.updateBudgetItem(item.id, body) : api.createBudgetItem(body)),
    item ? 'Budget item updated' : 'Budget item added',
  );

  const { amount, frequency, breakdown, gross_amount, deductions } = form.values;
  const monthly = typeof amount === 'number' ? amount * MONTHLY_FACTOR[frequency] : null;
  const paycheck = kind === 'income' && breakdown;
  const computedTakeHome = Math.round((num(gross_amount) - deductions.reduce((s, d) => s + num(d.amount), 0)) * 100) / 100;

  const addDeduction = (d: Omit<Deduction, 'amount'>) =>
    form.insertListItem('deductions', { ...d, amount: '', key: randomId() } satisfies DeductionRow);

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        save.mutate(
          {
            name: v.name.trim(),
            category_id: v.category_id!,
            amount: v.amount as number,
            frequency: v.frequency,
            notes: v.notes.trim() || null,
            paid_by_card: kind === 'expense' && v.paid_by_card,
            gross_amount: paycheck ? (v.gross_amount as number) : null,
            deductions: paycheck
              ? v.deductions.map((d) => ({
                  name: d.name.trim(),
                  type: d.type,
                  pre_tax: d.type !== 'tax' && d.pre_tax,
                  amount: d.amount as number,
                }))
              : [],
          },
          { onSuccess: onDone },
        ),
      )}
    >
      <Stack>
        <Group grow align="flex-start">
          <TextInput
            label="Name"
            placeholder={kind === 'income' ? "e.g. Jared's paycheck" : 'e.g. Mortgage'}
            data-autofocus
            {...form.getInputProps('name')}
          />
          <CategorySelect kind={kind} {...form.getInputProps('category_id')} />
        </Group>
        {kind === 'income' && (
          <Switch
            label="Break down this paycheck"
            description="Track gross pay, 401(k), insurance, and taxes. The budget counts take-home pay."
            {...form.getInputProps('breakdown', { type: 'checkbox' })}
          />
        )}
        <Group grow align="flex-start">
          {paycheck && (
            <NumberInput
              label="Gross pay"
              description="Per paycheck, before deductions"
              prefix="$"
              decimalScale={2}
              thousandSeparator=","
              min={0}
              {...form.getInputProps('gross_amount')}
            />
          )}
          <NumberInput
            label={paycheck ? 'Take-home pay' : 'Amount'}
            description={paycheck ? 'What hits your bank account' : undefined}
            prefix="$"
            decimalScale={2}
            thousandSeparator=","
            min={0}
            {...form.getInputProps('amount')}
          />
          <Select
            label="How often"
            description={paycheck ? 'Pay schedule' : undefined}
            data={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))}
            allowDeselect={false}
            {...form.getInputProps('frequency')}
          />
        </Group>
        {monthly != null && frequency !== 'monthly' && (
          <Text size="sm" c="dimmed" mt={-8}>
            ≈ {money(monthly)} per month{paycheck ? ' take-home' : ''}
          </Text>
        )}

        {paycheck && (
          <Box>
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Deductions per paycheck
              </Text>
              <Menu position="bottom-end" width={220}>
                <Menu.Target>
                  <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} rightSection={<IconChevronDown size={14} />}>
                    Add deduction
                  </Button>
                </Menu.Target>
                <Menu.Dropdown mah={360} style={{ overflowY: 'auto' }}>
                  {['Retirement', 'Insurance', 'Savings', 'Taxes', 'Other'].map((group) => (
                    <Box key={group}>
                      <Menu.Label>{group}</Menu.Label>
                      {DEDUCTION_PRESETS.filter((p) => p.group === group).map((p) => (
                        <Menu.Item key={p.label} onClick={() => addDeduction(p.deduction)}>
                          {p.label}
                        </Menu.Item>
                      ))}
                    </Box>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </Group>
            {deductions.length === 0 ? (
              <Text size="sm" c="dimmed">
                Add the lines from your pay stub, like 401(k), health insurance, and taxes. Anything you leave out shows as
                &ldquo;not itemized&rdquo;.
              </Text>
            ) : (
              <Stack gap="xs">
                {deductions.map((d, i) => (
                  <Group key={d.key} gap="xs" align="flex-start" wrap="nowrap">
                    <TextInput
                      placeholder="Name"
                      aria-label="Deduction name"
                      style={{ flex: 1, minWidth: 0 }}
                      {...form.getInputProps(`deductions.${i}.name`)}
                    />
                    <Select
                      aria-label="Type"
                      w={124}
                      data={Object.entries(DEDUCTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                      allowDeselect={false}
                      {...form.getInputProps(`deductions.${i}.type`)}
                    />
                    <Box w={80} pt={9}>
                      {d.type === 'tax' ? (
                        <Text size="xs" c="dimmed">
                          Withheld
                        </Text>
                      ) : (
                        <Checkbox size="xs" label="Pre-tax" {...form.getInputProps(`deductions.${i}.pre_tax`, { type: 'checkbox' })} />
                      )}
                    </Box>
                    <NumberInput
                      aria-label="Amount"
                      placeholder="$0.00"
                      w={120}
                      prefix="$"
                      decimalScale={2}
                      thousandSeparator=","
                      min={0}
                      hideControls
                      {...form.getInputProps(`deductions.${i}.amount`)}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      mt={4}
                      aria-label="Remove deduction"
                      onClick={() => form.removeListItem('deductions', i)}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </Box>
        )}

        {paycheck && num(gross_amount) > 0 && (
          <Box p="sm" style={{ background: 'var(--surface-container-high)', borderRadius: 'var(--mantine-radius-md)' }}>
            <Group justify="space-between" mb={4}>
              <Text className="label-sm">One paycheck</Text>
              {deductions.length > 0 && computedTakeHome > 0 && computedTakeHome !== amount && (
                <Anchor component="button" type="button" size="xs" onClick={() => form.setFieldValue('amount', computedTakeHome)}>
                  Set take-home to {money(computedTakeHome)}
                </Anchor>
              )}
            </Group>
            <PaycheckWaterfall
              gross={num(gross_amount)}
              takeHome={typeof amount === 'number' ? amount : null}
              lines={deductions.map((d) => ({ name: d.name, type: d.type, stage: stageOf(d), amount: num(d.amount) }))}
            />
          </Box>
        )}

        {kind === 'expense' && (
          <Checkbox
            label="Paid by credit card"
            description="Bank statements only show this inside a card payment, so it's compared with card payments instead of its category."
            {...form.getInputProps('paid_by_card', { type: 'checkbox' })}
          />
        )}
        <Textarea label="Notes" autosize minRows={1} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
