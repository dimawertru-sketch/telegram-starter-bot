import { Keyboard } from "grammy";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FILE = join(process.env.DATA_DIR || "./data", "finance.json");
const pending = new Map();

const categories = [
  "Продукты", "Кафе и рестораны", "Транспорт",
  "Жильё", "Одежда", "Развлечения",
  "Здоровье", "Покупки", "Подписки", "Другое"
];

const mainMenu = new Keyboard()
  .text("➕ Расход").text("💵 Доход").row()
  .text("💰 Баланс").text("📊 Статистика").row()
  .text("📅 По дням").text("📂 Категории").row()
  .text("📜 История").text("❌ Отмена")
  .resized().persistent();

function categoryMenu() {
  const kb = new Keyboard();
  categories.forEach((c, i) => {
    kb.text(c);
    if (i % 2 === 1) kb.row();
  });
  return kb.text("❌ Отмена").resized().persistent();
}

function rub(n) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2
  }).format(n);
}

function dateKey(date) {
  const d = new Date(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function dateLabel(key) {
  return new Date(key + "T12:00:00").toLocaleDateString("ru-RU");
}

async function load() {
  try {
    const d = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(d.operations) ? d : { operations: [] };
  } catch {
    return { operations: [] };
  }
}

async function save(data) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2));
}

function owner(ctx) {
  return Boolean(process.env.OWNER_ID) &&
    String(ctx.from?.id) === String(process.env.OWNER_ID);
}

function totals(ops) {
  const income = ops.filter(o => o.type === "income")
    .reduce((s, o) => s + o.amount, 0);
  const expense = ops.filter(o => o.type === "expense")
    .reduce((s, o) => s + o.amount, 0);
  return { income, expense, balance: income - expense };
}

function monthOperations(ops) {
  const now = new Date();
  return ops.filter(o => {
    const d = new Date(o.date);
    return d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
  });
}

export function registerCommands(bot) {
  bot.command("id", ctx =>
    ctx.reply(`Твой Telegram ID: ${ctx.from.id}`)
  );

  bot.command("start", async ctx => {
    if (!owner(ctx)) return ctx.reply("Нет доступа. Проверь OWNER_ID.");
    pending.delete(ctx.from.id);
    const { income, expense, balance } = totals(
      monthOperations((await load()).operations)
    );
    await ctx.reply(
      `💼 МОИ ФИНАНСЫ\n\n` +
      `💵 Доходы: ${rub(income)}\n` +
      `💸 Расходы: ${rub(expense)}\n` +
      `💰 Остаток: ${rub(balance)}\n\n` +
      `Выбери действие в меню внизу 👇`,
      { reply_markup: mainMenu }
    );
  });

  bot.on("message:text", async ctx => {
    if (!owner(ctx)) return;

    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const state = pending.get(userId);

    if (text === "❌ Отмена") {
      pending.delete(userId);
      return ctx.reply("Действие отменено. Главное меню 👇", {
        reply_markup: mainMenu
      });
    }

    if (text === "➕ Расход" || text === "💵 Доход") {
      pending.set(userId, {
        type: text === "➕ Расход" ? "expense" : "income",
        step: "category"
      });
      return ctx.reply("Выбери категорию 👇", {
        reply_markup: categoryMenu()
      });
    }

    if (text === "💰 Баланс") {
      pending.delete(userId);
      const { income, expense, balance } = totals((await load()).operations);
      return ctx.reply(
        `💰 ОБЩИЙ БАЛАНС\n\nДоходы: ${rub(income)}\n` +
        `Расходы: ${rub(expense)}\n\nОстаток: ${rub(balance)}`,
        { reply_markup: mainMenu }
      );
    }

    if (text === "📊 Статистика") {
      pending.delete(userId);
      const ops = monthOperations((await load()).operations);
      const { income, expense, balance } = totals(ops);
      return ctx.reply(
        `📊 СТАТИСТИКА ЗА МЕСЯЦ\n\n` +
        `🟢 Доходы: ${rub(income)}\n` +
        `🔴 Расходы: ${rub(expense)}\n` +
        `💰 Разница: ${rub(balance)}\n\n` +
        `Количество операций: ${ops.length}`,
        { reply_markup: mainMenu }
      );
    }

    if (text === "📅 По дням") {
      pending.delete(userId);
      const ops = monthOperations((await load()).operations);
      const days = {};

      for (const o of ops) {
        const key = dateKey(o.date);
        if (!days[key]) days[key] = { income: 0, expense: 0 };
        days[key][o.type] += o.amount;
      }

      const lines = Object.keys(days).sort().reverse().map(key =>
        `${dateLabel(key)}\n` +
        `🟢 +${rub(days[key].income)}  🔴 −${rub(days[key].expense)}`
      );

      return ctx.reply(
        "📅 РАСХОДЫ И ДОХОДЫ ПО ДНЯМ\n\n" +
        (lines.join("\n\n") || "Операций за этот месяц пока нет."),
        { reply_markup: mainMenu }
      );
    }

    if (text === "📂 Категории") {
      pending.delete(userId);
      const ops = monthOperations((await load()).operations)
        .filter(o => o.type === "expense");
      const groups = {};

      for (const o of ops) {
        const cat = o.category || o.note || "Другое";
        groups[cat] = (groups[cat] || 0) + o.amount;
      }

      const lines = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amount]) => `${cat}: ${rub(amount)}`);

      return ctx.reply(
        "📂 РАСХОДЫ ПО КАТЕГОРИЯМ\n\n" +
        (lines.join("\n") || "Расходов пока нет."),
        { reply_markup: mainMenu }
      );
    }

    if (text === "📜 История") {
      pending.delete(userId);
      const ops = (await load()).operations.slice(-15).reverse();
      const lines = ops.map(o =>
        `${o.type === "income" ? "🟢 +" : "🔴 −"}${rub(o.amount)}\n` +
        `${o.category || o.note || "Другое"} · ${dateLabel(dateKey(o.date))}`
      );

      return ctx.reply(
        "📜 ПОСЛЕДНИЕ ОПЕРАЦИИ\n\n" +
        (lines.join("\n\n") || "Операций пока нет."),
        { reply_markup: mainMenu }
      );
    }

    if (state?.step === "category") {
      if (!categories.includes(text)) {
        return ctx.reply("Выбери категорию кнопкой ниже 👇", {
          reply_markup: categoryMenu()
        });
      }

      pending.set(userId, {
        ...state,
        category: text,
        step: "amount"
      });

      return ctx.reply(
        `Категория: ${text}\n\nВведи сумму в рублях:`,
        { reply_markup: mainMenu }
      );
    }

    if (state?.step === "amount") {
      const amount = Number(text.replace(",", "."));

      if (!Number.isFinite(amount) || amount <= 0 ||
          amount > 1000000000) {
        return ctx.reply("Введи правильную сумму, например 350 или 1250,50.");
      }

      const data = await load();
      data.operations.push({
        type: state.type,
        amount: Math.round(amount * 100) / 100,
        category: state.category,
        date: new Date().toISOString()
      });

      await save(data);
      pending.delete(userId);

      return ctx.reply(
        `✅ ${state.type === "expense" ? "Расход" : "Доход"} сохранён!\n\n` +
        `${rub(amount)} · ${state.category}`,
        { reply_markup: mainMenu }
      );
    }

    if (!state) {
      return ctx.reply("Выбери действие в меню внизу 👇", {
        reply_markup: mainMenu
      });
    }
  });
}
