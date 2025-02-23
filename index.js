const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const xlsx = require('xlsx');
const db = require('./database'); // Import database
const sharp = require('sharp'); // Untuk membuat sticker
// Menggunakan LocalAuth untuk menyimpan sesi secara otomatis
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot" // Sesuaikan dengan nama bot kamu jika perlu
    })
});

let saldoAdmin = 0; // Inisialisasi saldo admin
let categories = {}; // Menyimpan kategori dan anggota yang terdaftar
let giveawayKeyword = "";

client.on('ready', async () => {
    console.log('Client sudah siap!');
    await loadCategories();
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('Autentikasi berhasil!');
});

client.on('auth_failure', msg => {
    console.error('Autentikasi gagal:', msg);
});

client.on('message_create', async message => {
    if (message.body === 'Ping') {
        message.reply('Tes Bot aja bro!');
    }

    // Format Job untuk rekap uang masuk
    const jobRegex = /Job:\s*(.*)\nHunter:\s*(.*)\nWorker:\s*(.*)\nFee:\s*(\d+)\nstatus:\s*selesai/i;

    if (jobRegex.test(message.body)) {
        const matches = message.body.match(jobRegex);
        const job = matches[1].trim();
        const hunter = matches[2].trim();
        const worker = matches[3].trim();
        const fee = parseInt(matches[4].trim());

        // Hitung pembagian fee
        const hunterFee = fee * 0.20;
        const workerFee = fee * 0.75;
        const adminFee = fee * 0.05;

        // Update saldo admin
        saldoAdmin += adminFee;

        // Simpan data transaksi ke database
        db.run(`INSERT INTO transactions (job, hunter, worker, fee, hunterFee, workerFee, adminFee, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [job, hunter, worker, fee, hunterFee, workerFee, adminFee, 'Selesai'], (err) => {
            if (err) {
                console.error(err);
                message.reply('Gagal menyimpan transaksi ke database.');
                return;
            }
            // Balas pesan
            message.reply(`Otw proses ya. Total fee: ${fee}\nHunter: ${hunterFee}\nWorker: ${workerFee}\nAdmin: ${adminFee}`);
            // Simpan data ke file Excel
            saveToExcel();
        });
    } else if (message.body === '!download') {
        // Kirim file Excel jika ada file yang sudah dibuat
        if (fs.existsSync('rekap_transaksi.xlsx')) {
            const media = MessageMedia.fromFilePath('rekap_transaksi.xlsx');
            await client.sendMessage(message.from, media, { caption: 'Nih filenya' });
        } else {
            message.reply('Belum ada file rekap transaksi bro.');
        }
    } else if (message.body === '!saldo') {
        message.reply(`Saldo Admin sekarang: ${saldoAdmin}`);
    } else if (message.body.startsWith('!tambahSaldo ')) {
        // Tambah saldo admin
        const amount = parseFloat(message.body.split(' ')[1]);
        if (!isNaN(amount) && amount > 0) {
            saldoAdmin += amount;
            message.reply(`Saldo Admin nambah ${amount}. Sekarang saldo Admin: ${saldoAdmin}`);
        } else {
            message.reply('Masukin jumlah yang valid buat nambah saldo.');
        }
    } else if (message.body === '!resetSaldo') {
        // Reset saldo admin
        saldoAdmin = 0;
        message.reply('Saldo Admin berhasil di-reset ke 0 bro.');
    } else if (message.body === '!menu') {
        // Menampilkan daftar command yang tersedia
        const menu = `
        ╭─✦ *FITUR BOT* ✦──╮  
        │  
        │ 🔹 *!ping*  
        │ 🔸 *!menu*   
        │ 🔹 *!download*   
        │ 🔹 *!format*    
        │ 🔸 *!tagall*    
        │ 🔹 *!tag [kategori]*   
        │ 🔸 *!pengumuman [pesan]*   
        │ 🔹 *!daftar [kategori]*   
        │ 🔸 *!keluarKategori [kategori]*   
        │ 🔹 *!tambah [kategori]*   
        │ 🔸 *!hapus [kategori]* 
        │ 🔹 *!list*  
        │  
        ╰───────────╯  
         Jangan mainin tagnya ya bjir!
         
        
        `;
        message.reply(menu);
    } else if (message.body === '!format') {
        // Menampilkan template format yang bisa dideteksi oleh bot
        const formatTemplate = `

Job: [Nama Job]
Hunter: [Nama Hunter note: nama aja jgn tag]
Worker: [Nama Worker note: nama aja jgn tag]
Fee: [Total Fee] jangan pakai titik ex : 25000
status: selesai

        `;
        message.reply(formatTemplate);
    } else if (message.body === '!tagall') {
        const chat = await message.getChat();
        if (chat.isGroup) {
            let mentions = chat.participants.map(id => `${id}`);
            let tagMessage =`🎯 *Tag kategori:\n` + mentions.map(id => `@${id.split('@')[0]}`).join(' ');;
    
            await chat.sendMessage(tagMessage, { mentions });
        } else {
            message.reply('Masih dalam tahap pengembangan, belum bisa ya.');
        }
    }
    else if (message.body.startsWith('!tag ')) {
        let chat = await message.getChat();
        const category = message.body.split(' ')[1];

        if (!category || !categories[category]) {
            return message.reply(`Kategori *${category}* ngga ada.`);
        }

        let mentions = categories[category].map(id => `${id}`);
        if (mentions.length === 0) return message.reply(`Tidak ada anggota yang terdaftar di kategori *${category}*.`);

        let tagMessage = `Yuk yang bisa ${category}*\n` + mentions.map(id => `@${id.split('@')[0]}`).join(' ');

        await chat.sendMessage(tagMessage, { mentions });
    }
    else if (message.hasMedia) {
        const media = await message.downloadMedia();
        if (message.body === '!sticker') {
            const inputPath = `./temp/${message.id.id}.jpg`;
            const outputPath = `./temp/${message.id.id}.webp`;
            
            fs.writeFileSync(inputPath, Buffer.from(media.data, 'base64'));
            await sharp(inputPath)
                .resize({ width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toFormat('webp')
                .toFile(outputPath);
            
            const stickerMedia = MessageMedia.fromFilePath(outputPath);
            await client.sendMessage(message.from, stickerMedia, { sendMediaAsSticker: true });
            
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
        }
    }
    else if (message.body.startsWith('!mulaiGiveaway ')) {
        let chat = await message.getChat();
        if (!chat.isGroup) return message.reply('Fitur ini hanya bisa digunakan dalam grup.');

        const args = message.body.split(' ');
        if (args.length < 3) return message.reply('Gunakan format: !mulaiGiveaway [jumlah pemenang] [kata kunci]');
        
        let numWinners = parseInt(args[1]);
        if (isNaN(numWinners) || numWinners < 1) return message.reply('Jumlah pemenang harus berupa angka positif.');
        
        giveawayKeyword = args.slice(2).join(' ');
        giveawayParticipants[chat.id._serialized] = { participants: [], numWinners };

        message.reply(`🎉 Giveaway dimulai! 🎉
Ketik: *${giveawayKeyword}* untuk ikut serta!`);
    }

    // Mendaftarkan Peserta Giveaway
    if (giveawayKeyword && message.body === giveawayKeyword) {
        let chat = await message.getChat();
        if (!chat.isGroup) return;

        let groupId = chat.id._serialized;
        if (!giveawayParticipants[groupId]) return;

        let userId = message.author || message.from;
        if (!giveawayParticipants[groupId].participants.includes(userId)) {
            giveawayParticipants[groupId].participants.push(userId);
            ;
        } 
    }

    // Memilih Pemenang Giveaway
    if (message.body.startsWith('!pilih')) {
        let chat = await message.getChat();
        if (!chat.isGroup) return message.reply('Fitur ini hanya bisa digunakan dalam grup.');

        let groupId = chat.id._serialized;
        if (!giveawayParticipants[groupId] || giveawayParticipants[groupId].participants.length === 0) {
            return message.reply('Tidak ada peserta yang terdaftar dalam giveaway.');
        }

        let { participants, numWinners } = giveawayParticipants[groupId];
        if (participants.length < numWinners) numWinners = participants.length;

        let winners = [];
        for (let i = 0; i < numWinners; i++) {
            let winnerIndex = Math.floor(Math.random() * participants.length);
            winners.push(participants[winnerIndex]);
            participants.splice(winnerIndex, 1);
        }

        let winnerMentions = winners.map(id => `@${id.split('@')[0]}`).join(' ');
        message.reply(`🎉 Selamat kepada ${winnerMentions} yang memenangkan giveaway! 🎉`, { mentions: winners });

        // Reset giveaway
        delete giveawayParticipants[groupId];
        giveawayKeyword = "";
    }

    else if (message.body.startsWith('!pengumuman ')) {
        let chat = await message.getChat();
    
        // Pastikan perintah hanya bisa digunakan dalam grup
        if (!chat.isGroup) {
            return message.reply('Masih tahap pengembangan');
        }
    
        // Pastikan daftar peserta grup tersedia
        if (!chat.participants) {
            return message.reply('Gagal mendapatkan daftar anggota grup.');
        }
    
        const announcement = message.body.slice(12).trim(); // Ambil pesan setelah '!pengumuman ' dan hapus spasi ekstra
        let mentions = chat.participants.map(p => p.id._serialized);
    
        if (mentions.length === 0) {
            return message.reply('Tidak ada anggota yang bisa di-mention.');
        }
    
        // Buat pesan pengumuman dengan mention
        let pengumumanMessage = `📢 *Pengumuman Penting!*\n\n${announcement}\n\n` + 
            mentions.map(id => `@${id.split('@')[0]}`).join(' ');
    
        // Kirim pengumuman dengan mention ke semua anggota grup
        await chat.sendMessage(pengumumanMessage, { mentions });
    
        message.reply('Pengumuman berhasil dikirim ke semua anggota grup.');
    }
    else if (message.body.startsWith('!daftar ')) {
        const category = message.body.split(' ')[1];
        if (category && categories[category]) {
            let chat = await message.getChat();
            let contactId = message.author;

            if (!categories[category]) categories[category] = [];
            if (!categories[category].includes(contactId)) {
                categories[category].push(contactId);
                db.run(`INSERT INTO category_members (category, contactId) VALUES (?, ?)`, [category, contactId]);
                message.reply(`Kamu berhasil daftar di spess *${category}*.`);
            } else {
                message.reply('udah daftar dispess ni masa lupa sih.');
            }
        }
    
    else if (message.body.startsWith('!keluarKategori ')) {
        const category = message.body.split(' ')[1];
        if (category) {
            let chat = await message.getChat();
            let contactId = message.author;

                categories[category] = categories[category].filter(id => id !== contactId);
                db.run(`DELETE FROM category_members WHERE category = ? AND contactId = ?`, [category, contactId]);
                message.reply(`Kamu udah keluar dari kategori ${category}.`);
            } else {
                message.reply('Command ini cuma bisa dipake di grup.');
            }
        } else {
            message.reply(`Kategori ${category} tidak ditemukan.`);
        }
    }
 else if (message.body.startsWith('!tambah ')) {
        // Menambahkan kategori baru
        const category = message.body.split(' ')[1];
        if (category) {
            if (!categories[category]) {
                categories[category] = [];
                db.run(`INSERT INTO categories (name) VALUES (?)`, [category], (err) => {
                    if (err) {
                        message.reply('Gagal menambahkan kategori.');
                    } else {
                        message.reply(`Kategori ${category} berhasil ditambahkan.`);
                    }
                });
            } else {
                message.reply('Kategori ini udah ada bro.');
            }
        } else {
            message.reply('Sebutkan nama kategori yang pengen ditambahkan.');
        }
    } else if (message.body.startsWith('!hapus ')) {
        // Menghapus kategori
        const category = message.body.split(' ')[1];
        if (category && categories[category]) {
            db.run(`DELETE FROM categories WHERE name = ?`, [category], (err) => {
                if (err) {
                    message.reply('Gagal menghapus kategori.');
                } else {
                    delete categories[category];
                    message.reply(`Kategori ${category} berhasil dihapus.`);
                }
            });
        } else {
            message.reply(`Kategori ${category} ga ada.`);
        }
    } else if (message.body === '!list') {
        // Menampilkan daftar kategori dalam format list
        const list = Object.keys(categories);
        
        if (list.length > 0) {
            const formattedList = list.map(cat => `- ${cat}`).join('\n');
            message.reply(`*Daftar Kategori:*\n${formattedList}`);
        } else {
            message.reply('Belum ada kategori.');
        }
    }
});

// Fungsi untuk menyimpan data transaksi ke Excel
function saveToExcel() {
    db.all(`SELECT * FROM transactions`, [], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(rows);
        xlsx.utils.book_append_sheet(wb, ws, 'Rekap Transaksi');

        xlsx.writeFile(wb, 'rekap_transaksi.xlsx');
    });
}

// Fungsi untuk memuat kategori dari database
function loadCategories() {
    db.all(`SELECT name FROM categories`, [], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        rows.forEach(row => {
            categories[row.name] = [];
        });

        db.all(`SELECT * FROM category_members`, [], (err, rows) => {
            if (err) {
                console.error(err);
                return;
            }

            rows.forEach(row => {
                if (categories[row.category]) {
                    categories[row.category].push(row.contactId);
                }
            });
        });
    });
}

// Mulai client
client.initialize();
