const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const readline = require("readline");
const dotenv = require("dotenv");
const express = require("express");
const schedule = require("node-schedule");
const cors = require("cors");

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID, 10); // Перетворення на число
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ""); // Сесія

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

const app = express();
app.use(express.json());
app.use(cors());
app.use(
  cors({
    origin: "http://localhost:3000",
  })
);

// Масив для зберігання запланованих повідомлень
const scheduledMessages = [];

// Функція для вводу з консолі
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

(async () => {
  console.log("Запуск Telegram клієнта...");

  // Авторизація, якщо сесія ще не збережена
  if (!stringSession.value) {
    await client.start({
      phoneNumber: async () => {
        const phone = await askQuestion("Введіть ваш номер телефону: ");
        return phone.trim();
      },
      password: async () => {
        const password = await askQuestion(
          "Введіть ваш пароль (2FA, якщо активовано): "
        );
        return password.trim();
      },
      phoneCode: async () => {
        const code = await askQuestion("Введіть код із Telegram: ");
        return code.trim();
      },
      onError: (err) => {
        console.error("Помилка авторизації:", err);
      },
    });

    console.log("Авторизація успішна!");
    console.log("Сесійний рядок:", client.session.save());

    // Зберігаємо сесію в .env
    process.env.TELEGRAM_SESSION = client.session.save();
  } else {
    console.log("Клієнт Telegram уже авторизований.");
    await client.connect();
  }

  // Ендпоінт для миттєвого надсилання повідомлень
  app.post("/send-message", async (req, res) => {
    const { chatId, message } = req.body;

    if (!chatId || !message) {
      return res
        .status(400)
        .send({ error: "chatId та message є обов'язковими параметрами" });
    }

    try {
      await client.sendMessage(chatId, { message });
      res.send({ status: "success", message: "Повідомлення надіслано" });
    } catch (err) {
      console.error("Помилка надсилання повідомлення:", err);
      res.status(500).send({
        error: "Помилка надсилання повідомлення",
        details: err.message,
      });
    }
  });

  // Ендпоінт для планування повідомлень
  app.post("/schedule-message", async (req, res) => {
    const { chatId, message, dateTime } = req.body;

    if (!chatId || !message || !dateTime) {
      return res.status(400).send({
        error: "chatId, message, та dateTime є обов'язковими параметрами",
      });
    }

    const date = new Date(dateTime);
    if (isNaN(date.getTime())) {
      return res.status(400).send({
        error:
          "Некоректний формат дати. Використовуйте ISO формат (YYYY-MM-DDTHH:mm:ss)",
      });
    }

    // Створюємо унікальний ідентифікатор
    const id = `${chatId}-${Date.now()}`;

    // Плануємо завдання
    const job = schedule.scheduleJob(date, async () => {
      try {
        await client.sendMessage(chatId, { message });
        console.log(`Повідомлення надіслано: ${message}`);
        // Видаляємо з масиву після виконання
        const index = scheduledMessages.findIndex((msg) => msg.id === id);
        if (index > -1) scheduledMessages.splice(index, 1);
      } catch (err) {
        console.error("Помилка надсилання запланованого повідомлення:", err);
      }
    });

    // Зберігаємо інформацію про завдання
    scheduledMessages.push({ id, chatId, message, dateTime, job });
    res.send({ status: "success", message: "Повідомлення заплановано", id });
  });

  // Ендпоінт для перегляду всіх запланованих повідомлень
  app.get("/scheduled-messages", (req, res) => {
    res.send(
      scheduledMessages.map(({ id, chatId, message, dateTime }) => ({
        id,
        chatId,
        message,
        dateTime,
      }))
    );
  });

  // Ендпоінт для видалення запланованого повідомлення
  app.delete("/scheduled-messages/:id", (req, res) => {
    const { id } = req.params;

    const index = scheduledMessages.findIndex((msg) => msg.id === id);
    if (index === -1) {
      return res
        .status(404)
        .send({ error: "Заплановане повідомлення не знайдено" });
    }

    // Скасовуємо завдання
    scheduledMessages[index].job.cancel();
    // Видаляємо із масиву
    scheduledMessages.splice(index, 1);

    res.send({
      status: "success",
      message: "Заплановане повідомлення видалено",
    });
  });

  // Запуск сервера
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
  });
})();
