const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const xlsx = require('xlsx');
const db = require('./database'); // Import database

// Menggunakan LocalAuth untuk menyimpan sesi secara otomatis
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot" // Sesuaikan dengan nama bot kamu jika perlu
    })
});

let saldoAdmin = 0; // Inisialisasi saldo admin
let categories = {}; // Menyimpan kategori dan anggota yang terdaftar

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
            await client.sendMessage(message.from, media, { caption: 'Nih file yang kamu minta bro!' });
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
        ╭─✦ *FITUR BOT WHATSAPP* ✦──╮  
        │  
        │ 🔹 *!ping* — 🔄 Cek respons bot  
        │ 🔸 *!menu* — 📜 Tampilkan daftar perintah  
        │ 🔹 *!download* — 📥 Download rekap transaksi (Excel)  
        │ 🔸 *!saldo* — 💵 Cek saldo Admin  
        │ 🔹 *!tambahSaldo [jumlah]* — ➕ Tambah saldo Admin  
        │ 🔸 *!resetSaldo* — ♻️ Reset saldo Admin ke 0  
        │ 🔹 *!format* — 📝 Format transaksi yang bisa dipakai  
        │ 🔸 *!tagall* — 👥 Mention semua anggota grup  
        │ 🔹 *!tag [kategori]* — 🎯 Mention anggota kategori tertentu  
        │ 🔸 *!pengumuman [pesan]* — 📢 Kirim pengumuman ke semua anggota grup  
        │ 🔹 *!daftar [kategori]* — 🏷️ Daftar ke kategori  
        │ 🔸 *!keluarKategori [kategori]* — 🚪 Keluar dari kategori  
        │ 🔹 *!tambahKategori [kategori]* — ➕ Tambah kategori baru  
        │ 🔸 *!hapusKategori [kategori]* — ❌ Hapus kategori  
        │ 🔹 *!listKategori* — 📋 Lihat daftar kategori yang tersedia  
        │  
        ╰──────────────────────╯  
        ✨ *Gunakan perintah dengan bijak dan tetap enjoy! 🚀*  
         
        
        `;
        message.reply(menu);
    } else if (message.body === '!format') {
        // Menampilkan template format yang bisa dideteksi oleh bot
        const formatTemplate = `
Gunakan format berikut untuk memasukkan data transaksi:

Job: [Nama Pekerjaan]
Hunter: [Nama Hunter]
Worker: [Nama Worker]
Fee: [Total Fee]
status: selesai
        `;
        message.reply(formatTemplate);
    } else if (message.body === '!tagall') {
        const chat = await message.getChat();
        if (chat.isGroup) {
            let mentions = chat.participants.map(p => p.id._serialized);
            let tagMessage = mentions.map(id => `@${id.split('@')[0]}`).join(' ');
    
            await chat.sendMessage(tagMessage, { mentions });
        } else {
            message.reply('Command ini cuma bisa dipakai di grup.');
        }
    }
    else if (message.body.startsWith('!tag ')) {
        const category = message.body.split(' ')[1];
        if (category && categories[category]) {
            const chat = await message.getChat();
            if (chat.isGroup) {
                let mentions = categories[category].map(id => id); // Pastikan ID-nya valid
                if (mentions.length === 0) {
                    return message.reply(`Kategori ${category} masih kosong.`);
                }
    
                let tagMessage = `📢 Yang bisa ${category}, yuk:\n` + mentions.map(id => `@${id.split('@')[0]}`).join(' ');
    
                await chat.sendMessage(tagMessage, { mentions });
            } else {
                message.reply('Command ini hanya bisa digunakan di grup.');
            }
        } else {
            message.reply(`Kategori ${category} tidak ditemukan.`);
        }
    }
    else if (message.body.startsWith('!pengumuman ')) {
        const chat = await message.getChat();
        if (chat.isGroup) {
            const announcement = message.body.slice(12).trim(); // Mengambil pesan setelah '!pengumuman '
            let mentions = chat.participants.map(p => p.id._serialized);
    
            if (mentions.length === 0) {
                return message.reply('Tidak ada anggota yang bisa di-mention.');
            }
    
            let tagMessage = `📢 *Pengumuman Penting!*\n\n${announcement}\n\n` +
                mentions.map(id => `@${id.split('@')[0]}`).join(' ');
    
            await chat.sendMessage(tagMessage, { mentions });
        } else {
            message.reply('Command ini hanya bisa digunakan di grup.');
        }
    }
    else if (message.body.startsWith('!daftar ')) {
        const category = message.body.split(' ')[1];
        if (category) {
            const chat = await message.getChat();
            if (chat.isGroup) {
                const contactId = message.author;
                if (!categories[category]) {
                    categories[category] = [];
                }
                if (!categories[category].includes(contactId)) {
                    categories[category].push(contactId);
                    db.run(`INSERT INTO category_members (category, contactId) VALUES (?, ?)`, [category, contactId]);
                    message.reply(`Kamu udah terdaftar di kategori ${category}.`);
                } else {
                    message.reply('Kamu sudah daftar di kategori ini.');
                }
            } else {
                message.reply('Command ini hanya bisa dipakai di grup.');
            }
        } else {
            message.reply('Sebutkan kategori yang ingin kamu daftar.');
        }
    }

    else if (message.body.startsWith('!keluarKategori ')) {
        const category = message.body.split(' ')[1];
        if (category && categories[category]) {
            const chat = await message.getChat();
            if (chat.isGroup) {
                const contactId = message.author;
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
 else if (message.body.startsWith('!tambahKategori ')) {
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
    } else if (message.body.startsWith('!hapusKategori ')) {
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
    } else if (message.body === '!listKategori') {
        // Menampilkan daftar kategori
        const list = Object.keys(categories).length > 0 ? Object.keys(categories).join(', ') : 'Belum ada kategori.';
        message.reply(`Daftar kategori: ${list}`);
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
