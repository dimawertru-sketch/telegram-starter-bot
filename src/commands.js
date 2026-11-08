
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const DATA_FILE = join(process.env.DATA_DIR || "/data", "finance.json")

async function loadData() {
  await mkdir(dirname(DATA_FILE), { recursive: true })
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"))
  } catch {
    return { operations: [] }
  }
}

async function saveData(data) {
  await mkdir(dirname(DATA_FILE), { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

function allowed(ctx) {
  const owner = process.env.OWNER_ID
  return owner && String(ctx.from?.id) === String(owner)
}

function money(value) {
  return Number(value).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  }) + " ₽"
}

function parseOperation(ctx) {
  const parts = String(ctx.match || "").trim().split(/\s+/)
  const amount = Number((parts.shift() || "").replace(",", "."))
  const description = parts.join(" ")

  if (!Number.isFinite(amount) || amount <= 0 || !description) {
    return null
  }

  return { amount, description }
}

export function registerCommands(bot) {
  bot.command("id", (ctx) =>
    ctx.reply(`Твой Telegram ID: ${ctx.from.id}`)
  )

  bot.command("start", (ctx) =>
    ctx.reply(
      "💰 Финансовый помощник\n\n" +
      "Команды:\n" +
      "/income 50000 Зарплата — доход\n" +
      "/expense 850 Продукты — расход\n" +
      "/balance — баланс\n" +
      "/stats — статистика месяца\n" +
      "/history — последние операции\n" +
      "/help — помощь\n" +
      "/id — твой Telegram ID"
    )
  )

  bot.command("help", (ctx) =>
    ctx.reply(
      "Примеры:\n" +
      "/income 50000 Зарплата\n" +
      "/expense 850 Продукты\n\n" +
      "Суммы указывай в рублях."
    )
  )

  bot.command("income", async (ctx) => {
    if (!allowed(ctx)) return ctx.reply("Доступ не настроен. Сначала настрой OWNER_ID.")
    const op = parseOperation(ctx)
    if (!op) return ctx.reply("Формат: /income 50000 Зарплата")

    const data = await loadData()
    data.operations.push({
      type: "income",
      ...op,
      date: new Date().toISOString(),
    })
    await saveData(data)
    await ctx.reply(`✅ Доход записан: ${money(op.amount)} — ${op.description}`)
  })

  bot.command("expense", async (ctx) => {
    if (!allowed(ctx)) return ctx.reply("Доступ не настроен. Сначала настрой OWNER_ID.")
    const op = parseOperation(ctx)
    if (!op) return ctx.reply("Формат: /expense 850 Продукты")

    const data = await loadData()
    data.operations.push({
      type: "expense",
      ...op,
      date: new Date().toISOString(),
    })
    await saveData(data)
    await ctx.reply(`✅ Расход записан: ${money(op.amount)} — ${op.description}`)
  })

  bot.command("balance", async (ctx) => {
    if (!allowed(ctx)) return ctx.reply("Нет доступа.")
    const data = await loadData()
    const income = data.operations
      .filter(x => x.type === "income")
      .reduce((sum, x) => sum + x.amount, 0)
    const expense = data.operations
      .filter(x => x.type === "expense")
      .reduce((sum, x) => sum + x.amount, 0)

    await ctx.reply(
      `💰 Доходы: ${money(income)}\n` +
      `💸 Расходы: ${money(expense)}\n` +
      `📊 Остаток: ${money(income - expense)}`
    )
  })

  bot.command("stats", async (ctx) => {
    if (!allowed(ctx)) return ctx.reply("Нет доступа.")
    const data = await loadData()
    const month = new Date().toISOString().slice(0, 7)
    const operations = data.operations.filter(x => x.date.startsWith(month))
    const income = operations
      .filter(x => x.type === "income")
      .reduce((sum, x) => sum + x.amount, 0)
    const expense = operations
      .filter(x => x.type === "expense")
      .reduce((sum, x) => sum + x.amount, 0)

    await ctx.reply(
      `📅 Статистика за ${month}\n\n` +
      `Доходы: ${money(income)}\n` +
      `Расходы: ${money(expense)}\n` +
      `Итог: ${money(income - expense)}`
    )
  })

  bot.command("history", async (ctx) => {
    if (!allowed(ctx)) return ctx.reply("Нет доступа.")
    const data = await loadData()
    const last = data.operations.slice(-10).reverse()

    if (!last.length) return ctx.reply("Операций пока нет.")

    const lines = last.map(x =>
      `${x.type === "income" ? "➕" : "➖"} ${money(x.amount)} — ${x.description}`
    )
    await ctx.reply("📋 Последние операции:\n\n" + lines.join("\n"))
  })
}
