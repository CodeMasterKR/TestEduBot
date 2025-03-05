require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const moment = require('moment');

// MongoDB ulanishi
const client = new MongoClient(process.env.DATABASE_URL);
let db;
let users;
let tests;
let testResults;

// Admin va o'qituvchi ID lari
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const TEACHER_IDS = (process.env.TEACHER_IDS || '').split(',').map(id => parseInt(id)).filter(Boolean);

// Botni ishga tushirish
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Xatoliklar bilan ishlash
bot.catch((err, ctx) => {
  console.error(`Update ${ctx.update.update_id} da xatolik:`, err);
  ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.').catch(console.error);
});

// O'qituvchi ekanligini tekshirish
const isTeacher = (userId) => TEACHER_IDS.includes(userId) || userId === ADMIN_ID;

// Kanal obunasini tekshirish middleware
const checkSubscription = async (ctx, next) => {
  try {
    if (!ctx.from) return next();
    if (isTeacher(ctx.from.id)) return next();

    const channels = process.env.REQUIRED_CHANNELS.split(',');
    for (const channel of channels) {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        return ctx.reply(`❌ Botdan foydalanish uchun ${channel} kanaliga obuna bo'ling!`, {
          reply_markup: {
            inline_keyboard: [[{ text: '📢 Kanalga o\'tish', url: `https://t.me/${channel.replace('@', '')}` }]]
          }
        });
      }
    }
    return next();
  } catch (error) {
    console.error('Obuna tekshirishda xato:', error);
    return next();
  }
};

// Motivatsion xabar shablonlari
const motivationalTemplates = {
  excellent: [
    "Ajoyib natija, {name}! Sen haqiqatan ham zo‘r harakat qilyapsan, {score}% juda ajoyib natija! Shunday davom et! 💪🔥",
    "{name}, natijang {score}%! Sen haqiqatan ham a'lo darajada ishlayapsan! Zo‘r ketayapsan! 🚀",
    "{name}, sening {score}% natijang hayratlanarli! Sen olg‘a intilishda davom et, g‘alaba yaqin! 🏆",
    "Bravo, {name}! {score}% - bu zo‘r natija! Sen haqiqatan ham harakat qilayotganing seziladi! 👏",
    "Sen super odamsan, {name}! {score}% - bu haqiqiy muvaffaqiyat! Shunday davom et! 🔥"
  ],
  good: [
    "{name}, {score}% natijang juda yaxshi! Lekin sen yanada zo‘r bo‘lishing mumkin! Shunday davom et! 💡",
    "Juda yaxshi, {name}! {score}% - bu yaxshi natija, ammo sen bundan ham yaxshiroq qila olasan! 😊",
    "{name}, sening natijang {score}%! Yaxshi! Harakatni to‘xtatma va eng yuqori cho‘qqiga erish! 🚀",
    "Zo‘r harakat, {name}! {score}% natijangni yana ham oshirish mumkin! O‘z ustingda ishlashni davom et! 💪",
    "{name}, {score}% natijang yaxshi! Keyingi safar yanada zo‘r natija kutib qolamiz! Sen bunga qodirsan! 🔥"
  ],
  average: [
    "{name}, sening natijang {score}%. Yaxshi harakat qilding! Lekin yana biroz mashq qilish kerak! 💡",
    "{name}, {score}% natijang fena emas! Lekin sen bundan ham yaxshisini qila olasan! O‘z ustingda ishlashda davom et! 🚀",
    "O‘rtacha natija, {name} ({score}%)! Keyingi safar undan ham yaxshi natija ko‘rsatishingga ishonamiz! 😊",
    "{name}, {score}% - yomon emas, ammo sen yanada yaxshiroq natija chiqarishing mumkin! 🔥",
    "Sen yaxshi harakat qilding, {name}! {score}% natijang - yaxshi boshlanish! Lekin oldinga intilish kerak! 💪"
  ],
  low: [
    "{name}, harakat qilishda davom et! {score}% natija - bu faqat boshlanishi! Sen bundan ham yaxshisini qila olasan! 🔥",
    "Unutma, {name}, muhim narsa – o‘rganish! {score}% - past bo‘lishi mumkin, lekin sen kelasi safar ancha yaxshi bo‘lasan! 🚀",
    "{name}, {score}% natijang seni tushkunlikka solmasin! Muhimi – xatolardan o‘rganish va oldinga intilish! 💪",
    "Boshlanishi qiyin bo‘lishi mumkin, {name}! {score}% hali hammasi emas! O‘z ustingda ishlashda davom et! 😊",
    "{name}, bu safar {score}% bo‘ldi, lekin keyingi safar bundan ham yaxshisini qila olasan! Sen kuchlisan! 🔥"
  ]
};

// Motivatsion xabarni olish
const getMotivationalMessage = (name, score) => {
  let category;
  if (score >= 86) category = 'excellent';
  else if (score >= 70) category = 'good';
  else if (score >= 50) category = 'average';
  else category = 'low';

  const messages = motivationalTemplates[category];
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex].replace('{name}', name).replace('{score}', score.toFixed(1));
};

// Ro'yxatdan o'tish sahna
const registrationScene = new Scenes.WizardScene(
  'registration',
  async (ctx) => {
    try {
      const channels = process.env.REQUIRED_CHANNELS.split(',').map(ch => ch.trim());
      for (const channel of channels) {
        const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
        if (!['creator', 'administrator', 'member'].includes(member.status)) {
          await ctx.reply(`❌ Botdan foydalanish uchun ${channel} kanaliga obuna bo'ling!`, {
            reply_markup: {
              inline_keyboard: [[{ text: '📢 Kanalga o\'tish', url: `https://t.me/${channel.replace('@', '')}` }]],
            },
          });
          return;
        }
      }
      await ctx.reply('Ismingizni kiriting:');
      return ctx.wizard.next();
    } catch (error) {
      console.error('Ro‘yxatdan o‘tish boshida xato:', error);
      await ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko‘ring.');
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('❌ Iltimos, ismingizni matn sifatida kiriting.');
      return;
    }
    ctx.session = ctx.session || {};
    ctx.session.firstName = ctx.message.text.trim();
    await ctx.reply('Familiyangizni kiriting:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply('❌ Iltimos, familiyangizni matn sifatida kiriting.');
      return;
    }
    ctx.session.lastName = ctx.message.text.trim();
    await ctx.reply('📱 Telefon raqamingizni yuborish uchun tugmani bosing:', {
      reply_markup: {
        keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    try {
      if (!ctx.message?.contact) {
        await ctx.reply('❌ Iltimos, "Telefon raqamni yuborish" tugmasini bosing.');
        return;
      }
      if (ctx.message.contact.user_id !== ctx.from.id) {
        await ctx.reply('❌ Faqat o‘zingizning telefon raqamingizni yuboring.');
        return;
      }

      const isUserTeacher = isTeacher(ctx.from.id);
      await users.insertOne({
        telegramId: ctx.from.id,
        firstName: ctx.session.firstName,
        lastName: ctx.session.lastName,
        phoneNumber: ctx.message.contact.phone_number,
        role: isUserTeacher ? 'TEACHER' : 'STUDENT',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.reply(`✅ ${isUserTeacher ? 'O‘qituvchi' : 'O‘quvchi'} sifatida ro‘yxatdan o‘tdingiz!`, {
        reply_markup: { remove_keyboard: true },
      });
      await showMainMenu(ctx, isUserTeacher ? 'TEACHER' : 'STUDENT');
      ctx.session = {};
      return ctx.scene.leave();
    } catch (error) {
      console.error('Ro‘yxatdan o‘tishda xato:', error);
      await ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko‘ring.');
      return ctx.scene.leave();
    }
  }
);

// Test yaratish sahna (ko'p faylli)
const createTestScene = new Scenes.WizardScene(
  'createTest',
  async (ctx) => {
    if (!isTeacher(ctx.from.id)) {
      ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');
      return ctx.scene.leave();
    }
    ctx.reply('📝 Test mavzusini kiriting:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    ctx.session.testTitle = ctx.message.text;
    ctx.reply('📋 Test javoblarini kiriting (har bir javob yangi qatorda, masalan:\n1-a\n2-b\n3-c\n...)');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const answers = ctx.message.text.split('\n')
      .map(line => line.trim())
      .filter(line => /^\d+-[a-d]$/i.test(line));

    if (answers.length === 0) {
      ctx.reply('❌ Noto\'g\'ri format. Iltimos qaytadan kiriting (masalan: 1-a)');
      return;
    }

    ctx.session.testAnswers = answers;
    ctx.session.testFileIds = []; // Fayl ID larini saqlash uchun ro'yxat
    ctx.reply(
      '📎 Test uchun fayllarni yuboring (PDF, rasm yoki boshqa formatda).\n' +
      'Bir nechta fayl yuborish uchun har birini alohida yuboring.\n' +
      'Fayllarni yuborib bo\'lgach, "tayyor" deb yozing.'
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text?.toLowerCase() === 'tayyor') {
      if (ctx.session.testFileIds.length === 0) {
        ctx.reply('❌ Hech bo\'lmaganda bitta fayl yuborishingiz kerak!');
        return;
      }
      ctx.reply('⏰ Test muddatini kiriting (DD.MM.YYYY HH:mm formatida):');
      return ctx.wizard.next();
    }

    let fileId;
    if (ctx.message?.document) {
      fileId = ctx.message.document.file_id;
    } else if (ctx.message?.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else {
      ctx.reply('❌ Iltimos, fayl yuboring (PDF, rasm yoki boshqa formatda) yoki "tayyor" deb yozing.');
      return;
    }

    ctx.session.testFileIds.push(fileId);
    ctx.reply(`✅ Fayl qo\'shildi (${ctx.session.testFileIds.length} ta). Yana fayl yuboring yoki "tayyor" deb yozing.`);
  },
  async (ctx) => {
    try {
      const deadline = moment(ctx.message.text, 'DD.MM.YYYY HH:mm');
      if (!deadline.isValid()) {
        ctx.reply('❌ Noto\'g\'ri sana formati. Iltimos qaytadan kiriting (DD.MM.YYYY HH:mm):');
        return;
      }

      const test = await tests.insertOne({
        title: ctx.session.testTitle,
        answers: ctx.session.testAnswers,
        fileIds: ctx.session.testFileIds, // Bir nechta fayl ID lari
        deadline: deadline.toDate(),
        createdBy: ctx.from.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.reply('✅ Test muvaffaqiyatli yaratildi!');

      const buttons = [
        [
          { text: '✏️ Tahrirlash', callback_data: `edit_${test.insertedId}` },
          { text: '📊 Natijalar', callback_data: `results_${test.insertedId}` },
          { text: '🗑 O\'chirish', callback_data: `delete_${test.insertedId}` },
        ],
        [{ text: '📥 Natijalarni yuklab olish', callback_data: `download_${test.insertedId}` }],
      ];

      await ctx.reply(
        `📋 Test: ${ctx.session.testTitle}\n` +
        `📝 Savollar soni: ${ctx.session.testAnswers.length}\n` +
        `📎 Fayllar soni: ${ctx.session.testFileIds.length}\n` +
        `⏰ Muddat: ${deadline.format('DD.MM.YYYY HH:mm')}`,
        {
          reply_markup: {
            inline_keyboard: buttons,
          },
        }
      );

      await showMainMenu(ctx, 'TEACHER');
      return ctx.scene.leave();
    } catch (error) {
      console.error('Test yaratishda xato:', error);
      ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
      return ctx.scene.leave();
    }
  }
);

// Testni tahrirlash sahna
const editTestScene = new Scenes.WizardScene(
  'editTest',
  async (ctx) => {
    try {
      const testId = ctx.session.editingTest;
      const test = await tests.findOne({ _id: new ObjectId(testId) });

      if (!test) {
        ctx.reply('❌ Test topilmadi');
        return ctx.scene.leave();
      }

      ctx.session.currentTest = test;
      ctx.reply(
        '📝 Test ma\'lumotlarini tahrirlash\n\n' +
        'Nima o\'zgartirmoqchisiz?\n\n' +
        '1. Test mavzusi\n' +
        '2. Test javoblari\n' +
        '3. Test fayllari\n' +
        '4. Test muddati\n\n' +
        'Raqamni tanlang yoki "bekor" deb yozing',
        {
          reply_markup: {
            keyboard: [['1', '2', '3', '4'], ['bekor']],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return ctx.wizard.next();
    } catch (error) {
      console.error('Test tahrirlash sahna xatosi:', error);
      ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    if (ctx.message.text === 'bekor') {
      await showMainMenu(ctx, 'TEACHER');
      return ctx.scene.leave();
    }

    const choice = parseInt(ctx.message.text);
    if (![1, 2, 3, 4].includes(choice)) {
      ctx.reply('❌ Noto\'g\'ri tanlov. 1, 2, 3 yoki 4 raqamlaridan birini tanlang');
      return;
    }

    ctx.session.editChoice = choice;
    switch (choice) {
      case 1:
        ctx.reply('📝 Yangi test mavzusini kiriting:');
        break;
      case 2:
        ctx.reply(
          '📋 Yangi test javoblarini kiriting (har bir javob yangi qatorda):\n' +
          'Masalan:\n1-a\n2-b\n3-c'
        );
        break;
      case 3:
        ctx.reply(
          '📎 Yangi fayllarni yuboring (PDF, rasm yoki boshqa formatda).\n' +
          'Bir nechta fayl yuborish uchun har birini alohida yuboring.\n' +
          'Fayllarni yuborib bo\'lgach, "tayyor" deb yozing.'
        );
        ctx.session.newFileIds = [];
        break;
      case 4:
        ctx.reply('⏰ Yangi test muddatini kiriting (DD.MM.YYYY HH:mm):');
        break;
    }
    return ctx.wizard.next();
  },
  async (ctx) => {
    try {
      const testId = ctx.session.editingTest;
      const choice = ctx.session.editChoice;
      const update = {};

      if (choice === 3 && ctx.message?.text?.toLowerCase() !== 'tayyor') {
        let fileId;
        if (ctx.message?.document) {
          fileId = ctx.message.document.file_id;
        } else if (ctx.message?.photo) {
          fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else {
          ctx.reply('❌ Iltimos, fayl yuboring yoki "tayyor" deb yozing.');
          return;
        }
        ctx.session.newFileIds.push(fileId);
        ctx.reply(`✅ Fayl qo\'shildi (${ctx.session.newFileIds.length} ta). Yana fayl yuboring yoki "tayyor" deb yozing.`);
        return;
      }

      switch (choice) {
        case 1:
          update.title = ctx.message.text;
          break;
        case 2:
          const answers = ctx.message.text.split('\n')
            .map(line => line.trim())
            .filter(line => /^\d+-[a-d]$/i.test(line));
          if (answers.length === 0) {
            ctx.reply('❌ Noto\'g\'ri format. Iltimos qaytadan kiriting (masalan: 1-a)');
            return;
          }
          update.answers = answers;
          break;
        case 3:
          if (ctx.session.newFileIds.length === 0) {
            ctx.reply('❌ Hech bo\'lmaganda bitta fayl yuborishingiz kerak!');
            return;
          }
          update.fileIds = ctx.session.newFileIds;
          break;
        case 4:
          const deadline = moment(ctx.message.text, 'DD.MM.YYYY HH:mm');
          if (!deadline.isValid()) {
            ctx.reply('❌ Noto\'g\'ri sana formati. Iltimos qaytadan kiriting (DD.MM.YYYY HH:mm):');
            return;
          }
          update.deadline = deadline.toDate();
          break;
      }

      update.updatedAt = new Date();

      await tests.updateOne(
        { _id: new ObjectId(testId) },
        { $set: update }
      );

      await ctx.reply('✅ Test muvaffaqiyatli yangilandi!');
      await showMainMenu(ctx, 'TEACHER');
      return ctx.scene.leave();
    } catch (error) {
      console.error('Test yangilashda xato:', error);
      ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
      return ctx.scene.leave();
    }
  }
);

// Sahnani ro'yxatga olish
const stage = new Scenes.Stage([registrationScene, createTestScene, editTestScene]);
bot.use(stage.middleware());

// Start buyrug'i
bot.command('start', async (ctx) => {
  try {
    await ctx.reply('👋 Xush kelibsiz!');
    const user = await users.findOne({ telegramId: ctx.from.id });

    if (!user) {
      return ctx.scene.enter('registration');
    }

    return showMainMenu(ctx, isTeacher(ctx.from.id) ? 'TEACHER' : 'STUDENT');
  } catch (error) {
    console.error('Start buyrug\'ida xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

// Asosiy menyuni ko'rsatish
const showMainMenu = async (ctx, role) => {
  try {
    const buttons = role === 'TEACHER' ? [
      [{ text: '📝 Test yaratish' }],
      [{ text: '📊 Testlarni boshqarish' }],
      [{ text: '📈 Natijalarni ko\'rish' }],
      [{ text: '👩‍🎓 O\'quvchilar haqida' }],
      [{ text: '📢 Hammaga xabar yuborish' }],
    ] : [
      [{ text: '📚 Mavjud testlar' }],
      [{ text: '🎯 Mening natijalarim' }],
    ];

    await ctx.reply('📱 Asosiy menyu:', {
      reply_markup: {
        keyboard: buttons,
        resize_keyboard: true,
      },
    });
  } catch (error) {
    console.error('Menyu ko\'rsatishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
};

// O'qituvchi buyruqlari
bot.hears('📝 Test yaratish', async (ctx) => {
  try {
    if (!isTeacher(ctx.from.id)) {
      return ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');
    }
    return ctx.scene.enter('createTest');
  } catch (error) {
    console.error('Test yaratishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.hears('📊 Testlarni boshqarish', async (ctx) => {
  try {
    if (!isTeacher(ctx.from.id)) {
      return ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');
    }

    const userTests = await tests.find({ 
      createdBy: ctx.from.id 
    }).sort({ createdAt: 1 }).toArray();
    
    if (userTests.length === 0) {
      return ctx.reply('📭 Hozircha testlar yo\'q');
    }

    for (const test of userTests) {
      const teacher = await users.findOne({ telegramId: test.createdBy });
      const buttons = [
        [
          { text: '✏️ Tahrirlash', callback_data: `edit_${test._id}` },
          { text: '📊 Natijalar', callback_data: `results_${test._id}` },
          { text: '🗑 O\'chirish', callback_data: `delete_${test._id}` },
        ],
        [{ text: '📥 Natijalarni yuklab olish', callback_data: `download_${test._id}` }],
      ];

      await ctx.reply(
        `📋 Test: ${test.title}\n` +
        `👨‍🏫 O'qituvchi: ${teacher?.firstName || 'Noma\'lum'} ${teacher?.lastName || ''}\n` +
        `📝 Savollar soni: ${test.answers.length}\n` +
        `📎 Fayllar soni: ${test.fileIds?.length || 0}\n` +
        `⏰ Muddat: ${moment(test.deadline).format('DD.MM.YYYY HH:mm')}`,
        {
          reply_markup: {
            inline_keyboard: buttons,
          },
        }
      );
    }
  } catch (error) {
    console.error('Testlarni boshqarishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.hears('📈 Natijalarni ko\'rish', async (ctx) => {
  try {
    if (!isTeacher(ctx.from.id)) {
      return ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');
    }

    const userTests = await tests.find({ createdBy: ctx.from.id }).toArray();
    
    if (userTests.length === 0) {
      return ctx.reply('📭 Hozircha testlar yo\'q');
    }

    const buttons = userTests.map(test => [{
      text: `📊 ${test.title}`,
      callback_data: `results_${test._id}`,
    }]);

    ctx.reply('📈 Qaysi testning natijalarini ko\'rmoqchisiz?', {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    console.error('Natijalarni ko\'rishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.hears('👩‍🎓 O\'quvchilar haqida', async (ctx) => {
  try {
    if (!isTeacher(ctx.from.id)) return ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');

    const students = await users.find({ role: 'STUDENT' }).toArray();
    if (students.length === 0) return ctx.reply('📭 Hozircha o\'quvchilar yo\'q');

    let message = '👩‍🎓 <b>O\'quvchilar ro\'yxati</b> 👨‍🎓\n\n';
    for (const [index, student] of students.entries()) {
      message += `👤 <b>${index + 1}. ${student.firstName} ${student.lastName}</b>\n`;
      message += `📱 Telefon: ${student.phoneNumber}\n`;
      message += `🆔 ID: ${student.telegramId}\n\n`;
      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🗑 O\'chirish', callback_data: `delete_student_${student.telegramId}` }
          ]]
        }
      });
      message = '';
    }
  } catch (error) {
    console.error('O\'quvchilarni ko\'rishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi.');
  }
});

bot.action(/delete_student_(.+)/, async (ctx) => {
  try {
    const studentId = parseInt(ctx.match[1]);
    const student = await users.findOne({ telegramId: studentId, role: 'STUDENT' });

    if (!student) {
      await ctx.reply('❌ Bunday o\'quvchi topilmadi.');
      return ctx.answerCbQuery();
    }

    await users.deleteOne({ telegramId: studentId });
    await testResults.deleteMany({ userId: studentId });
    await ctx.reply(`✅ ${student.firstName} ${student.lastName} muvaffaqiyatli o\'chirildi!`);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('O\'quvchini o\'chirishda xato:', error);
    await ctx.reply('❌ Xatolik yuz berdi.');
    await ctx.answerCbQuery();
  }
});

bot.hears('📢 Hammaga xabar yuborish', async (ctx) => {
  try {
    if (!isTeacher(ctx.from.id)) return ctx.reply('❌ Sizda o\'qituvchi huquqlari yo\'q');
    await ctx.reply('Hammaga yuboriladigan xabarni yozing (faqat matn):');
    ctx.session.waitingForBroadcast = true;
  } catch (error) {
    console.error('Xabar yuborish so\'rovida xato:', error);
    ctx.reply('❌ Xatolik yuz berdi.');
  }
});

bot.action(/results_(.+)/, async (ctx) => {
  try {
    const testId = ctx.match[1];
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    
    if (!test) {
      return ctx.reply('❌ Test topilmadi');
    }

    if (test.createdBy !== ctx.from.id && ctx.from.id !== ADMIN_ID) {
      return ctx.reply('❌ Siz faqat o\'zingiz yaratgan testlarning natijalarini ko\'ra olasiz');
    }

    const results = await testResults.aggregate([
      { $match: { testId: new ObjectId(testId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'telegramId',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $sort: { submittedAt: -1 } },
    ]).toArray();

    if (results.length === 0) {
      return ctx.reply('📭 Bu test uchun natijalar yo\'q');
    }

    let message = `📊 <b>${test.title} - Natijalar</b>\n\n`;
    for (const result of results) {
      const color = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
      message += `${color} ${result.user.firstName} ${result.user.lastName}: ${result.score.toFixed(1)}%\n`;
    }

    const buttons = [[{ text: '📥 Natijalarni yuklash', callback_data: `download_${testId}` }]];

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    console.error('Test natijalarini ko\'rishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.action(/delete_(.+)/, async (ctx) => {
  try {
    const testId = ctx.match[1];
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    
    if (!test) {
      return ctx.reply('❌ Test topilmadi');
    }

    if (test.createdBy !== ctx.from.id && ctx.from.id !== ADMIN_ID) {
      return ctx.reply('❌ Siz faqat o\'zingiz yaratgan testlarni o\'chira olasiz');
    }

    await tests.deleteOne({ _id: new ObjectId(testId) });
    await testResults.deleteMany({ testId: new ObjectId(testId) });

    await ctx.reply('✅ Test muvaffaqiyatli o\'chirildi');
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Test o\'chirishda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.action(/edit_(.+)/, async (ctx) => {
  try {
    const testId = ctx.match[1];
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    
    if (!test) {
      return ctx.reply('❌ Test topilmadi');
    }

    if (test.createdBy !== ctx.from.id && ctx.from.id !== ADMIN_ID) {
      return ctx.reply('❌ Siz faqat o\'zingiz yaratgan testlarni tahrirlashingiz mumkin');
    }

    ctx.session.editingTest = testId;
    ctx.scene.enter('editTest');
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Test tahrirlashda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

// O'quvchi buyruqlari
bot.hears('📚 Mavjud testlar', async (ctx) => {
  try {
    const availableTests = await tests.find({
      deadline: { $gt: new Date() },
    })
    .sort({ createdAt: 1 })
    .toArray();

    if (availableTests.length === 0) {
      return ctx.reply('📭 Hozircha mavjud testlar yo\'q');
    }

    for (const test of availableTests) {
      const teacher = await users.findOne({ telegramId: test.createdBy });
      const studentResult = await testResults.findOne({
        testId: test._id,
        userId: ctx.from.id,
      });
      
      let status;
      let buttonText;
      
      if (studentResult) {
        status = `✅ Ishlangan (${studentResult.score.toFixed(1)}%)`;
        buttonText = `✅ Ishlangan (${studentResult.score.toFixed(1)}%)`;
      } else if (test.deadline && new Date(test.deadline) < new Date()) {
        status = '⌛️ Muddat tugagan';
        buttonText = '⌛️ Muddat tugagan';
      } else {
        status = '🆕 Yangi';
        buttonText = '✍️ Testni boshlash';
      }

      await ctx.reply(
        `📋 Test: ${test.title}\n` +
        `👨‍🏫 O'qituvchi: ${teacher?.firstName || 'Noma\'lum'} ${teacher?.lastName || ''}\n` +
        `📝 Savollar soni: ${test.answers.length}\n` +
        `📎 Fayllar soni: ${test.fileIds?.length || 0}\n` +
        `⏰ Muddat: ${moment(test.deadline).format('DD.MM.YYYY HH:mm')}\n` +
        `📊 Holat: ${status}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: buttonText, callback_data: `take_${test._id}` },
            ]],
          },
        }
      );
    }
  } catch (error) {
    console.error('Mavjud testlarda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.hears('🎯 Mening natijalarim', async (ctx) => {
  try {
    const results = await testResults.aggregate([
      { $match: { userId: ctx.from.id } },
      {
        $lookup: {
          from: 'tests',
          localField: 'testId',
          foreignField: '_id',
          as: 'test',
        },
      },
      { $unwind: '$test' },
      { $sort: { submittedAt: -1 } },
    ]).toArray();

    if (results.length === 0) {
      return ctx.reply('📭 Hozircha natijalar yo\'q');
    }

    let message = '🎯 <b>Sizning natijalaringiz</b>:\n\n';
    for (const result of results) {
      const color = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
      message += `📋 ${result.test.title}\n`;
      message += `${color} Ball: ${result.score.toFixed(1)}%\n`;
      message += `📅 Topshirilgan vaqt: ${moment(result.submittedAt).format('DD.MM.YYYY HH:mm')}\n\n`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Natijalarda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.action(/take_(.+)/, async (ctx) => {
  try {
    const testId = ctx.match[1];
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    
    if (!test) {
      return ctx.reply('Test topilmadi.');
    }

    if (test.deadline < new Date()) {
      return ctx.reply('Ushbu testning muddati tugagan.');
    }

    const existingResult = await testResults.findOne({
      userId: ctx.from.id,
      testId: new ObjectId(testId),
    });

    if (existingResult) {
      return ctx.reply('Siz bu testni allaqachon topshirgansiz.');
    }

    if (test.fileIds && test.fileIds.length > 0) {
      for (const fileId of test.fileIds) {
        try {
          await ctx.replyWithDocument(fileId, {
            caption: '📎 Test fayli',
          });
        } catch (error) {
          console.error('Fayl yuborishda xato:', error);
          await ctx.reply('⚠️ Test faylini yuborishda xatolik yuz berdi');
        }
      }
    } else {
      await ctx.reply('⚠️ Ushbu test uchun fayl mavjud emas.');
    }

    await ctx.reply(
      `📝 ${test.title} testi.\n\n` +
      `Savollar soni: ${test.answers.length}\n` +
      `⏰ Muddat: ${moment(test.deadline).format('DD.MM.YYYY HH:mm')}\n\n` +
      `Javoblarni quyidagi formatda yuboring:\n` +
      `1-a\n2-b\n3-c\n...\n\n` +
      `Eslatma: Barcha javoblarni bir xabarda yuborish kerak!`
    );
    
    ctx.session.currentTest = testId;
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Test boshlashda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.on('text', async (ctx) => {
  if (ctx.session?.waitingForBroadcast) {
    try {
      const messageTemplate = ctx.message.text;
      const students = await users.find({ role: 'STUDENT' }).toArray();

      if (students.length === 0) {
        await ctx.reply('📭 Hozircha o\'quvchilar yo\'q.');
      } else {
        let successCount = 0;
        for (const student of students) {
          try {
            const formattedMessage = `📢 <b>O'qituvchidan xabar</b>\n\n${messageTemplate}`;
            await bot.telegram.sendMessage(student.telegramId, formattedMessage, { parse_mode: 'HTML' });
            successCount++;
          } catch (error) {
            console.error(`Xabar ${student.telegramId} ga yuborilmadi:`, error);
          }
        }
        await ctx.reply(`✅ Xabar ${successCount}/${students.length} o\'quvchiga yuborildi.`);
      }

      delete ctx.session.waitingForBroadcast;
      await showMainMenu(ctx, 'TEACHER');
    } catch (error) {
      console.error('Xabar tarqatishda xato:', error);
      ctx.reply('❌ Xatolik yuz berdi.');
    }
    return;
  }

  if (!ctx.session?.currentTest) return;

  try {
    const testId = ctx.session.currentTest;
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    
    if (!test) {
      delete ctx.session.currentTest;
      return ctx.reply('Test topilmadi.');
    }

    if (test.deadline < new Date()) {
      delete ctx.session.currentTest;
      return ctx.reply('Testning muddati tugagan.');
    }

    const userAnswers = ctx.message.text.split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => /^\d+-[a-d]$/i.test(line));

    if (userAnswers.length === 0) {
      return ctx.reply(
        'Noto\'g\'ri format. Javoblarni quyidagi formatda yuboring:\n' +
        '1-a\n2-b\n3-c\n...'
      );
    }

    if (userAnswers.length !== test.answers.length) {
      return ctx.reply(
        `Barcha savollarga javob bermadingiz.\n` +
        `Savollar soni: ${test.answers.length}\n` +
        `Sizning javoblaringiz: ${userAnswers.length}`
      );
    }

    const correctAnswers = test.answers.map(a => a.toLowerCase());
    let correctCount = 0;

    userAnswers.forEach(answer => {
      if (correctAnswers.includes(answer)) {
        correctCount++;
      }
    });

    const score = (correctCount / test.answers.length) * 100;

    await testResults.insertOne({
      userId: ctx.from.id,
      testId: new ObjectId(test._id),
      answers: userAnswers,
      score,
      submittedAt: new Date(),
    });

    delete ctx.session.currentTest;

    const color = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
    const emoji = score >= 80 ? '🎉' : score >= 60 ? '👍' : '😕';
    
    const user = await users.findOne({ telegramId: ctx.from.id });
    const motivationalMessage = getMotivationalMessage(`${user.firstName} ${user.lastName}`, score);
    
    const resultMessage = `${emoji} <b>Test natijasi</b>:\n\n` +
      `${color} Ball: ${score.toFixed(1)}%\n` +
      `✅ To'g'ri javoblar: ${correctCount} ta\n` +
      `❌ Noto'g'ri javoblar: ${test.answers.length - correctCount} ta\n\n` +
      `${motivationalMessage}`;

    await ctx.reply(resultMessage, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Matnni qayta ishlashda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

bot.action(/download_(.+)/, async (ctx) => {
  try {
    const testId = ctx.match[1];
    const test = await tests.findOne({ _id: new ObjectId(testId) });
    if (!test) {
      return ctx.reply('❌ Test topilmadi');
    }

    await ctx.reply('📊 Natijalar yuklanmoqda...');

    const results = await testResults.aggregate([
      { $match: { testId: new ObjectId(testId) } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'telegramId',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $sort: { score: -1 } },
    ]).toArray();

    if (results.length === 0) {
      return ctx.reply('❌ Bu test uchun hali natijalar yo\'q');
    }

    const content = [];
    content.push('='.repeat(50) + '\n');
    content.push(' '.repeat(20) + test.title + '\n');
    content.push('='.repeat(50) + '\n\n');

    content.push('TEST HAQIDA MA\'LUMOT\n');
    content.push('-'.repeat(30) + '\n');
    content.push(`Yaratilgan vaqt: ${moment(test.createdAt).format('DD.MM.YYYY HH:mm')}\n`);
    content.push(`Savollar soni: ${test.answers.length}\n`);
    content.push(`Fayllar soni: ${test.fileIds?.length || 0}\n`);
    content.push(`Jami qatnashchilar: ${results.length}\n\n`);

    content.push('NATIJALAR\n');
    content.push('-'.repeat(30) + '\n');
    content.push('№  | F.I.SH                 | Ball  | To\'g\'ri/Noto\'g\'ri | Status\n');
    content.push('-'.repeat(70) + '\n');
    
    results.forEach((result, index) => {
      const name = result.user ? `${result.user.lastName || ''} ${result.user.firstName || ''}`.padEnd(20) : 'Noma\'lum'.padEnd(20);
      const score = `${(result.score || 0).toFixed(1)}%`.padEnd(6);
      const answers = `${result.correctAnswers || 0}/${result.wrongAnswers || 0}`.padEnd(15);
      const status = (result.score || 0) >= 80 ? "🟢 A'lo" : (result.score || 0) >= 60 ? "🟡 Yaxshi" : "🔴 Qoniqarsiz";
      content.push(`${(index + 1).toString().padStart(2)}  | ${name} | ${score} | ${answers} | ${status}\n`);
    });
    content.push('\n');

    const scores = results.map(r => r.score || 0);
    const avgScore = (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1);
    const maxScore = Math.max(...scores).toFixed(1);
    const minScore = Math.min(...scores).toFixed(1);
    
    content.push('STATISTIKA\n');
    content.push('-'.repeat(30) + '\n');
    content.push(`O'rtacha ball: ${avgScore}%\n`);
    content.push(`Eng yuqori ball: ${maxScore}%\n`);
    content.push(`Eng past ball: ${minScore}%\n`);
    content.push(`A'lo baholar: ${results.filter(r => (r.score || 0) >= 80).length}\n`);
    content.push(`Yaxshi baholar: ${results.filter(r => (r.score || 0) >= 60 && (r.score || 0) < 80).length}\n`);
    content.push(`Qoniqarsiz baholar: ${results.filter(r => (r.score || 0) < 60).length}\n`);

    const date = moment().format('DD_MM_YYYY_HH_mm');
    const safeTitle = test.title.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 30);
    const filename = `${safeTitle}_${date}.txt`;

    await ctx.replyWithDocument({
      source: Buffer.from(content.join(''), 'utf8'),
      filename: filename,
    }, {
      caption: `📄 ${test.title}\n📅 ${moment().format('DD.MM.YYYY HH:mm')}`,
    });

    await ctx.reply('✅ Natijalar muvaffaqiyatli yuklandi!');
  } catch (error) {
    console.error('Yuklashda xato:', error);
    ctx.reply('❌ Xatolik yuz berdi. Iltimos qayta urinib ko\'ring.');
  }
});

// Botni ishga tushirish
async function startBot() {
  try {
    await client.connect();
    console.log('MongoDB ga ulandi');
    
    db = client.db('test-bot');
    users = db.collection('users');
    tests = db.collection('tests');
    testResults = db.collection('testResults');

    await users.createIndex({ telegramId: 1 }, { unique: true });
    await tests.createIndex({ createdBy: 1 });
    await testResults.createIndex({ userId: 1 });
    await testResults.createIndex({ testId: 1 });

    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query', 'my_chat_member'],
    });
    console.log('Bot muvaffaqiyatli ishga tushdi');

    process.once('SIGINT', async () => {
      console.log('Yopilmoqda...');
      await bot.stop('SIGINT');
      await client.close();
    });
    process.once('SIGTERM', async () => {
      console.log('Yopilmoqda...');
      await bot.stop('SIGTERM');
      await client.close();
    });
  } catch (error) {
    console.error('Ishga tushirishda xato:', error);
    await client.close();
    process.exit(1);
  }
}

startBot().catch(console.error);