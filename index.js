require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const ytpl = require('ytpl');
const axios = require('axios'); // ประกาศที่นี่เพียงครั้งเดียว

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log('Bot is online!');
});

// คิวเพลง
const queue = new Map();

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const serverQueue = queue.get(message.guild.id);

    // เปลี่ยน !play เป็น ap
    if (message.content.startsWith('ap')) {
        const args = message.content.split(' ').slice(1);
        const query = args.join(' ');

        if (!query) {
            return message.channel.send('กรุณาระบุชื่อเพลงที่ต้องการค้นหาหรือ URL ของ Playlist.');
        }

        const channel = message.member.voice.channel;
        if (!channel) {
            return message.channel.send('คุณต้องอยู่ในช่องเสียงเพื่อเล่นเพลง.');
        }

        // ตรวจสอบว่าเป็น URL ของ Playlist หรือไม่
        if (query.startsWith('https://www.youtube.com/playlist')) {
            try {
                const playlist = await ytpl(query);
                const songs = playlist.items.map(video => ({
                    title: video.title,
                    url: video.url
                }));

                if (!serverQueue) {
                    const queueConstruct = {
                        textChannel: message.channel,
                        voiceChannel: channel,
                        connection: null,
                        songs: [],
                        playing: true,
                        repeat: false,
                        repeatQueue: false
                    };

                    queue.set(message.guild.id, queueConstruct);
                    queueConstruct.songs.push(...songs);

                    try {
                        const connection = joinVoiceChannel({
                            channelId: channel.id,
                            guildId: message.guild.id,
                            adapterCreator: message.guild.voiceAdapterCreator
                        });
                        queueConstruct.connection = connection;

                        // เริ่มเล่นเพลง
                        play(message.guild, queueConstruct.songs[0]);
                    } catch (error) {
                        console.error('Error connecting to the voice channel:', error);
                        queue.delete(message.guild.id);
                        return message.channel.send('เกิดข้อผิดพลาดในการเชื่อมต่อกับช่องเสียง.');
                    }
                } else {
                    serverQueue.songs.push(...songs);
                    return message.channel.send(`เพิ่มเพลงในคิว: ${songs.map(song => song.title).join(', ')}`);
                }
            } catch (error) {
                console.error('Error fetching playlist:', error);
                return message.channel.send('เกิดข้อผิดพลาดในการดึงข้อมูล Playlist.');
            }
        } else {
            // ค้นหาเพลงจาก YouTube
            const { videos } = await ytSearch(query);
            if (videos.length === 0) {
                return message.channel.send('ไม่พบผลลัพธ์.');
            }

            const video = videos[0];
            const song = {
                title: video.title,
                url: video.url
            };

            if (!serverQueue) {
                const queueConstruct = {
                    textChannel: message.channel,
                    voiceChannel: channel,
                    connection: null,
                    songs: [],
                    playing: true,
                    repeat: false,
                    repeatQueue: false
                };

                queue.set(message.guild.id, queueConstruct);
                queueConstruct.songs.push(song);

                try {
                    const connection = joinVoiceChannel({
                        channelId: channel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator
                    });
                    queueConstruct.connection = connection;

                    // เริ่มเล่นเพลง
                    play(message.guild, queueConstruct.songs[0]);
                } catch (error) {
                    console.error('Error connecting to the voice channel:', error);
                    queue.delete(message.guild.id);
                    return message.channel.send('เกิดข้อผิดพลาดในการเชื่อมต่อกับช่องเสียง.');
                }
            } else {
                serverQueue.songs.push(song);
                return message.channel.send(`เพิ่มเพลงในคิว: ${song.title}`);
            }
        }
    }

    // คำสั่งเล่นซ้ำทั้งคิว
    if (message.content.startsWith('ar')) {
        if (!serverQueue) {
            return message.channel.send('ไม่มีเพลงที่กำลังเล่นเพื่อให้ทำการเล่นซ้ำทั้งคิว.');
        }
        serverQueue.repeatQueue = !serverQueue.repeatQueue; // สลับสถานะการเล่นซ้ำทั้งคิว
        message.channel.send(`การเล่นซ้ำทั้งคิว: ${serverQueue.repeatQueue ? 'เปิด' : 'ปิด'}`);
    }

    // คำสั่งดูคิวเพลง
    if (message.content.startsWith('alist')) {
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.channel.send('คิวเพลงปัจจุบันว่างอยู่.');
        }

        const queueMessage = serverQueue.songs.map((song, index) => `${index + 1}. ${song.title}`).join('\n');
        // แบ่งข้อความถ้ายาวเกิน 2000 ตัวอักษร
        const chunkSize = 2000;
        for (let i = 0; i < queueMessage.length; i += chunkSize) {
            message.channel.send(queueMessage.slice(i, i + chunkSize));
        }
    }

    // คำสั่งข้ามเพลง
    if (message.content.startsWith('ask')) {
        if (!serverQueue) {
            return message.channel.send('ไม่มีเพลงให้ข้าม!');
        }
        serverQueue.songs.shift(); // ข้ามเพลง
        play(message.guild, serverQueue.songs[0]); // เล่นเพลงถัดไป
        return message.channel.send('ข้ามเพลงปัจจุบัน.');
    }

    // คำสั่งหยุดเพลง
    if (message.content.startsWith('as')) {
        const channel = message.member.voice.channel;
        if (!channel) {
            return message.channel.send('คุณต้องอยู่ในช่องเสียงเพื่อหยุดเพลง.');
        }

        const connection = serverQueue?.connection;
        if (connection) {
            connection.destroy();
            queue.delete(message.guild.id);
            message.channel.send('หยุดเล่นเพลงแล้ว.');
        } else {
            message.channel.send('ไม่มีเพลงกำลังเล่นอยู่ตอนนี้.');
        }
    }

    // คำสั่งลบเพลงจากคิว
    if (message.content.startsWith('adel')) {
        const args = message.content.split(' ').slice(1);
        const index = parseInt(args[0]);

        if (isNaN(index) || index < 1 || index > (serverQueue?.songs.length || 0)) {
            return message.channel.send('กรุณาระบุเลขคิวที่ถูกต้อง.');
        }

        const removedSong = serverQueue.songs.splice(index - 1, 1); // ลบเพลงจากคิว
        message.channel.send(`ลบเพลง: ${removedSong[0].title} จากคิวแล้ว.`);
    }
});

// ฟังก์ชันเล่นเพลง
function play(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        serverQueue.connection.destroy();
        queue.delete(guild.id);
        return;
    }

    const stream = ytdl(song.url, {
        filter: 'audioonly',
        highWaterMark: 1 << 25 // เพิ่มขนาด buffer เป็น 32MB
    });

    const resource = createAudioResource(stream);
    const audioPlayer = createAudioPlayer();

    audioPlayer.play(resource);

    // จัดการเหตุการณ์เมื่อเพลงเล่นจบหรือเกิดข้อผิดพลาด
    audioPlayer.on(AudioPlayerStatus.Idle, () => {
        if (serverQueue.repeat) {
            play(guild, song); // เล่นเพลงเดิมซ้ำ
        } else if (serverQueue.repeatQueue) {
            serverQueue.songs.push(serverQueue.songs.shift()); // ย้ายเพลงแรกไปท้ายคิวแล้วเล่นต่อ
            play(guild, serverQueue.songs[0]);
        } else {
            serverQueue.songs.shift(); // ลบเพลงที่เล่นไปแล้วออกจากคิว
            if (serverQueue.songs.length > 0) {
                play(guild, serverQueue.songs[0]); // เล่นเพลงถัดไปถ้ามีเพลงในคิว
            } else {
                serverQueue.connection.destroy(); // ออกจากช่องเสียงถ้าคิวว่าง
                queue.delete(guild.id); // ลบคิวของเซิร์ฟเวอร์
            }
        }
    });

    audioPlayer.on('error', error => {
        console.error('Error:', error.message);
        serverQueue.textChannel.send('เกิดข้อผิดพลาดระหว่างเล่นเพลง.');
        serverQueue.songs.shift(); // ลบเพลงที่เกิดปัญหาออกจากคิว
        if (serverQueue.songs.length > 0) {
            play(guild, serverQueue.songs[0]); // เล่นเพลงถัดไปถ้ามี
        } else {
            serverQueue.connection.destroy(); // ออกจากช่องเสียงถ้าไม่มีเพลงในคิว
            queue.delete(guild.id); // ลบคิวของเซิร์ฟเวอร์
        }
    });

    serverQueue.connection.subscribe(audioPlayer);
    serverQueue.textChannel.send(`ตอนนี้กำลังเล่น: ${song.title}`);
}

client.login(process.env.BOT_TOKEN);
