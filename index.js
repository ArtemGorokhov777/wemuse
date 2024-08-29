require('dotenv').config(); // Подключение и настройка dotenv
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

// Использование переменных окружения
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const bot = new TelegramBot(token, { polling: true });

// Начальные данные расписания
const initialSchedule = [
  { day: 'Понедельник', time: '20:00', lesson_type: 'STRIP 0/1', instructor: 'Ксения Петрушина', max_slots: 8 },
  { day: 'Понедельник', time: '21:00', lesson_type: 'STRETCHING', instructor: 'Ксения Петрушина', max_slots: 8 },
  { day: 'Вторник', time: '14:00', lesson_type: 'STRIP 0/1', instructor: '', max_slots: 8 },
  { day: 'Вторник', time: '20:00', lesson_type: 'STRIP 1/2', instructor: 'Ксения Петрушина', max_slots: 8 },
  { day: 'Среда', time: '19:00', lesson_type: 'STRIP 0', instructor: 'Александра Паранюк', max_slots: 8 },
  { day: 'Среда', time: '20:00', lesson_type: 'STRIP 0/1', instructor: 'Екатерина Ручьева', max_slots: 8 },
  { day: 'Четверг', time: '20:00', lesson_type: 'ОФП + Stretching', instructor: 'Бондарева/Гутовская', max_slots: 8 },
  { day: 'Пятница', time: '14:00', lesson_type: 'STRIP 0/1', instructor: '', max_slots: 8 },
  { day: 'Пятница', time: '20:00', lesson_type: 'STRIP 0/1', instructor: 'Ксения Петрушина', max_slots: 8 },
  { day: 'Пятница', time: '21:00', lesson_type: 'STRIP 1/2', instructor: 'Ксения Петрушина', max_slots: 8 },
  { day: 'Суббота', time: '15:00', lesson_type: 'STRIP 0', instructor: 'Александра Паранюк', max_slots: 8 },
  { day: 'Суббота', time: '16:00', lesson_type: 'STRIP 0/1', instructor: 'Екатерина Ручьева', max_slots: 8 }
];

// Подключение к базе данных SQLite
const db = new sqlite3.Database('./dance_lessons.db');

// Создание таблиц
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    instructor TEXT,
    lesson_type TEXT,
    day TEXT,
    time TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT,
    time TEXT,
    lesson_type TEXT,
    instructor TEXT,
    max_slots INTEGER,
    booked_slots INTEGER DEFAULT 0
  )`);
});

// Очистка таблицы schedule и заполнение начальными данными
db.serialize(() => {
  db.run(`DELETE FROM schedule`, (err) => {
    if (err) {
      console.error('Ошибка при очистке таблицы schedule:', err.message);
    } else {
      console.log('Таблица schedule очищена');
      populateInitialSchedule(); // Заполняем таблицу начальными данными после очистки
    }
  });
});

// Функция для проверки и добавления начального расписания
async function populateInitialSchedule() {
  for (const { day, time, lesson_type, instructor, max_slots } of initialSchedule) {
    try {
      const row = await new Promise((resolve, reject) => {
        db.get(`SELECT id FROM schedule WHERE day = ? AND time = ? AND lesson_type = ?`, [day, time, lesson_type], (err, row) => {
          if (err) reject(err);
          resolve(row);
        });
      });

      if (!row) {
        await new Promise((resolve, reject) => {
          db.run(`INSERT INTO schedule (day, time, lesson_type, instructor, max_slots) VALUES (?, ?, ?, ?, ?)`,
            [day, time, lesson_type, instructor, max_slots], (err) => {
              if (err) reject(err);
              resolve();
            });
        });
      }
    } catch (err) {
      console.error('Ошибка при проверке или добавлении записи:', err.message);
    }
  }
}

// Объект для хранения состояния пользователя
const userState = {};

// Функция для создания клавиатуры с днями недели
function getDaysKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Понедельник', callback_data: 'day_Понедельник' },
          { text: 'Вторник', callback_data: 'day_Вторник' },
          { text: 'Среда', callback_data: 'day_Среда' }
        ],
        [
          { text: 'Четверг', callback_data: 'day_Четверг' },
          { text: 'Пятница', callback_data: 'day_Пятница' },
          { text: 'Суббота', callback_data: 'day_Суббота' }
        ],
        [
          { text: '❌ Отмена бронирования', callback_data: 'cancel_booking' },
          { text: '📜 Мои записи', callback_data: 'my_bookings' } // Добавлена кнопка "Мои записи"
        ]
      ]
    }
  };
}

// Функция для создания клавиатуры со временем и типом занятий
async function getTimeAndLessonTypesKeyboard(day, includeBackButton = false) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT time, lesson_type, instructor, max_slots, booked_slots FROM schedule WHERE day = ?`, [day], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const keyboard = [];
        rows.forEach((row) => {
          const freeSlots = row.max_slots - row.booked_slots;
          const instructorText = row.instructor ? ` (${row.instructor})` : '';
          const buttonText = `${row.time} - ${row.lesson_type}${instructorText}\nСвободно: ${freeSlots} мест`;

          keyboard.push([{ text: buttonText, callback_data: `time_${row.time}_${row.lesson_type}` }]);
        });

        // Добавляем кнопку "Назад", если нужно
        if (includeBackButton) {
          keyboard.push([{ text: 'Назад', callback_data: 'cancel' }]);
        }

        resolve({
          reply_markup: {
            inline_keyboard: keyboard,
            resize_keyboard: true,
          },
          parse_mode: 'Markdown'
        });
      }
    });
  });
}

// Функция для создания клавиатуры с типами занятий
async function getLessonTypesKeyboard(day) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT DISTINCT lesson_type FROM schedule WHERE day = ?`, [day], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const keyboard = rows.map(row => [
          { text: row.lesson_type, callback_data: `lesson_type_${day}_${row.lesson_type}` },
          
          
        ]);

        keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_days' }]);

        resolve({
          reply_markup: {
            inline_keyboard: keyboard,
            resize_keyboard: true,
          }
        });
      }
    });
  });
}

// Функция для отправки напоминаний о занятиях
function sendReminders() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.toLocaleString('ru-RU', { weekday: 'long' });

  db.all(`SELECT * FROM lessons WHERE day = ? AND time = ?`, [currentDay, `${currentHour + 1}:00`], (err, rows) => {
    if (err) {
      console.error('Ошибка при получении данных для напоминаний:', err);
      return;
    }
    rows.forEach(row => {
      bot.sendMessage(row.user_id, `🔔 Напоминание: ваше занятие "${row.lesson_type}" начнется через час в ${row.time}. Преподаватель: ${row.instructor}.`);
    });
  });
}

// Настройка напоминаний ежечасно
setInterval(sendReminders, 60 * 60 * 1000);

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = {};
  bot.sendMessage(chatId, '👋 Добро пожаловать! Выберите день для записи на групповое занятие танцами:', getDaysKeyboard());
});

// Обработка callback_query
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (!userState[chatId]) {
    userState[chatId] = {};
  }

  try {
    if (data.startsWith('day_')) {
      const day = data.split('_')[1];
      userState[chatId].day = day;

      const timeKeyboard = await getTimeAndLessonTypesKeyboard(day, true);
      bot.sendMessage(chatId, `Выберите время и тип занятия в ${day}:`, timeKeyboard);

    } else if (data.startsWith('time_')) {
      const [_, time, lessonType] = data.split('_');
      userState[chatId].time = time;
      userState[chatId].lessonType = lessonType;
      bot.sendMessage(chatId, 'Введите ваше имя:');
      userState[chatId].waitingFor = 'name';

    } else if (data === 'cancel') {
      bot.sendMessage(chatId, 'Вы вернулись к главному меню.', getDaysKeyboard());

    } else if (data === 'cancel_booking') {
      db.all(`SELECT id, day, time, lesson_type FROM lessons WHERE user_id = ?`, [chatId], (err, rows) => {
        if (err || rows.length === 0) {
          bot.sendMessage(chatId, '🚫 У вас нет активных бронирований.');
        } else {
          const keyboard = rows.map(row => [
            { text: `${row.day}, ${row.time}, ${row.lesson_type}`, callback_data: `cancel_${row.id}` }
          ]);
          bot.sendMessage(chatId, 'Выберите бронирование для отмены:', { reply_markup: { inline_keyboard: keyboard } });
        }
      });

    } else if (data.startsWith('cancel_')) {
      const lessonId = data.split('_')[1];
      db.get(`SELECT * FROM lessons WHERE id = ? AND user_id = ?`, [lessonId, chatId], (err, row) => {
        if (err || !row) {
          bot.sendMessage(chatId, 'Ошибка: не удалось найти ваше бронирование.');
        } else {
          db.run(`DELETE FROM lessons WHERE id = ?`, [lessonId], (err) => {
            if (err) {
              bot.sendMessage(chatId, 'Ошибка при отмене бронирования.');
            } else {
              db.run(`UPDATE schedule SET booked_slots = booked_slots - 1 WHERE day = ? AND time = ? AND lesson_type = ?`,
                [row.day, row.time, row.lesson_type], (err) => {
                  if (err) {
                    bot.sendMessage(chatId, 'Ошибка при обновлении данных занятия.');
                  } else {
                    bot.sendMessage(chatId, `Ваше бронирование на занятие "${row.lesson_type}" в ${row.day} в ${row.time} было успешно отменено.`);
                  }
                });
            }
          });
        }
      });

    } else if (data === 'my_bookings') {
      db.all(`SELECT day, time, lesson_type, instructor FROM lessons WHERE user_id = ?`, [chatId], (err, rows) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Произошла ошибка при получении ваших бронирований.');
        } else if (rows.length === 0) {
          bot.sendMessage(chatId, '📜 У вас нет активных бронирований.');
        } else {
          let message = '📋 Ваши бронирования:\n\n';
          rows.forEach((row) => {
            message += `🗓️ День: ${row.day}\n` +
                       `🕒 Время: ${row.time}\n` +
                       `🎓 Тип занятия: ${row.lesson_type}\n` +
                       `👩‍🏫 Инструктор: ${row.instructor}\n` +
                       '------------------------------------\n\n';
          });
          bot.sendMessage(chatId, message);
        }
      });

    }

    bot.answerCallbackQuery(callbackQuery.id);

  } catch (error) {
    console.error('Ошибка при обработке callback_query:', error.message);
    bot.sendMessage(chatId, 'Произошла ошибка. Пожалуйста, попробуйте снова.');
  }
});
// Обработка команды /my_bookings
bot.onText(/\/my_bookings/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT day, time, lesson_type, instructor FROM lessons WHERE user_id = ?`, [chatId], (err, rows) => {
    if (err) {
      bot.sendMessage(chatId, '❌ Произошла ошибка при получении ваших бронирований.');
    } else if (rows.length === 0) {
      bot.sendMessage(chatId, '📜 У вас нет активных бронирований.');
    } else {
      let message = '📋 Ваши бронирования:\n\n';
      rows.forEach((row) => {
        message += `🗓️ День: ${row.day}\n` +
                   `🕒 Время: ${row.time}\n` +
                   `🎓 Тип занятия: ${row.lesson_type}\n` +
                   `👩‍🏫 Инструктор: ${row.instructor}\n` +
                   '------------------------------------\n\n';
      });
      bot.sendMessage(chatId, message);
    }
  });
});
// Обработка ввода пользователя
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userState[chatId]) {
    if (userState[chatId].waitingFor === 'name') {
      userState[chatId].name = text;
      bot.sendMessage(chatId, 'Введите ваш номер телефона:');
      userState[chatId].waitingFor = 'phone';

    } else if (userState[chatId].waitingFor === 'phone') {
      userState[chatId].phone = text;
      saveBooking(chatId);
    }
  }
});

// Функция для сохранения бронирования в базу данных
function saveBooking(chatId) {
  const { day, time, lessonType, name, phone } = userState[chatId];
  db.get(`SELECT instructor, max_slots, booked_slots FROM schedule WHERE day = ? AND time = ? AND lesson_type = ?`,
    [day, time, lessonType], (err, row) => {
      if (err || !row) {
        bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении данных. Попробуйте еще раз.');
      } else {
        if (row.booked_slots >= row.max_slots) {
          bot.sendMessage(chatId, '🚫 Извините, все места на это занятие уже заняты.');
        } else {
          db.run(`INSERT INTO lessons (user_id, name, phone, instructor, lesson_type, day, time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [chatId, name, phone, row.instructor, lessonType, day, time], (err) => {
              if (err) {
                bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении данных. Попробуйте еще раз.');
              } else {
                db.run(`UPDATE schedule SET booked_slots = booked_slots + 1 WHERE day = ? AND time = ? AND lesson_type = ?`,
                  [day, time, lessonType], (err) => {
                    if (err) {
                      bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных занятия.');
                    } else {
                      bot.sendMessage(chatId, `✅ Вы успешно записаны на занятие "${lessonType}" в ${day} в ${time}.
Ваш преподаватель: ${row.instructor}
Ваше имя: ${name}
Телефон: ${phone}
Для отмены бронирования, используйте команду /cancel_booking`);
                      delete userState[chatId];
                    }
                  });
              }
            });
        }
      }
    });
}

// Просмотр свободных слотов
bot.onText(/\/free_slots/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Выберите день недели:', getDaysKeyboard());
});

// Отмена бронирования
bot.onText(/\/cancel_booking/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT id, day, time, lesson_type FROM lessons WHERE user_id = ?`, [chatId], (err, rows) => {
    if (err || rows.length === 0) {
      bot.sendMessage(chatId, '🚫 У вас нет активных бронирований.');
    } else {
      const keyboard = rows.map(row => [
        { text: `${row.day}, ${row.time}, ${row.lesson_type}`, callback_data: `cancel_${row.id}` }
      ]);
      bot.sendMessage(chatId, 'Выберите бронирование для отмены:', { reply_markup: { inline_keyboard: keyboard } });
    }
  });
});

// Административная панель для администратора
bot.onText(/\/admin_panel/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId === adminChatId) {
    bot.sendMessage(chatId, '⚙️ Административная панель:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👥 Показать записавшихся', callback_data: 'show_bookings' }]
        ]
      }
    });
  }
});

// Показ записавшихся клиентов
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data === 'show_bookings' && chatId === adminChatId) {
    db.all(`SELECT day, time, lesson_type, name, phone, instructor FROM lessons ORDER BY 
             CASE 
               WHEN day = 'Понедельник' THEN 1 
               WHEN day = 'Вторник' THEN 2 
               WHEN day = 'Среда' THEN 3 
               WHEN day = 'Четверг' THEN 4 
               WHEN day = 'Пятница' THEN 5 
               WHEN day = 'Суббота' THEN 6 
               ELSE 7 
             END, time`, [], (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Ошибка при получении списка записавшихся.');
      } else if (rows.length === 0) {
        bot.sendMessage(chatId, '📜 Никто ещё не записался на занятия.');
      } else {
        let message = '📋 Список записавшихся клиентов:\n\n';
        rows.forEach((row) => {
          message += `🗓️ День: ${row.day}\n` +
                     `🕒 Время: ${row.time}\n` +
                     `🎓 Тип занятия: ${row.lesson_type}\n` +
                     `👩‍🏫 Инструктор: ${row.instructor}\n` +
                     `🧑‍🎓 Имя: ${row.name}\n` +
                     `📞 Телефон: ${row.phone}\n` +
                     '------------------------------------\n\n';
        });

        bot.sendMessage(chatId, message);
      }
    });
  }

  bot.answerCallbackQuery(callbackQuery.id);
});
