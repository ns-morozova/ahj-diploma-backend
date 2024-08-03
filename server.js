const fs = require('fs');
const http = require('http');
const Koa = require('koa');
const cors = require('@koa/cors');
const koaBody = require('koa-body').default;
const koaStatic = require('koa-static');
const path = require('path');
const app = new Koa();
app.use(cors());
const pub = path.join(__dirname, '/public');

let connections = [];
let pinned = null;


function deleteAllFilesInDirectory(directory) {
    // Читаем содержимое каталога
    const files = fs.readdirSync(directory);

    // Проходим по каждому элементу в каталоге
    for (const file of files) {
        const filePath = path.join(directory, file);

        // Проверяем, является ли элемент файлом или директорией
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            // Если это директория, рекурсивно удаляем её содержимое
            deleteAllFilesInDirectory(filePath);
            // Удаляем саму директорию
            fs.rmdirSync(filePath);
        } else {
            // Если это файл, удаляем его
            fs.unlinkSync(filePath);
        }
    }
}

app.use(koaStatic(pub));

app.use(
    koaBody({
        text: true,
        urlencoded: true,
        multipart: true,
        json: true,
        jsonLimit: "150mb",
    })
);

app.use((ctx, next) => {

    if (ctx.request.method !== 'OPTIONS') {
        next();
        return;
    }
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.set('Access-Control-Allow-Methods', 'DELETE, PUT, PATCH, GET, POST');
    ctx.response.set('Access-Control-Allow-Headers', 'Content-Type');
    ctx.response.status = 204;
    ctx.disableBodyParser = true;
});


app.use((ctx, next) => {
    if (ctx.request.url.includes('/sse')) {

        const clientId = ctx.query.clientId;
        ctx.clientId = clientId;

        ctx.res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
        });

        if (ctx.request.headers.accept && ctx.request.headers.accept === "text/event-stream") {
            // Добавляем подключение в массив
            connections.push(ctx);
            // При отключении удаляем его из массива
            ctx.req.on('close', () => {
                connections = connections.filter(conn => conn !== ctx);
            });
        }

        // Говорим Koa не завершать ответ
        ctx.respond = false;
    } else {
        next();
    }
});

app.use((ctx, next) => {
    if (ctx.request.method !== 'POST') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'createTicket') {
        next();
        return;
    }

    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;

    const objData = (typeof (ctx.request.body) == 'string') ? JSON.parse(ctx.request.body) : ctx.request.body;

    const nameFile = path.join(pub, objData.id);
    const jsonData = JSON.stringify(objData);
    fs.writeFileSync(nameFile, jsonData);

    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.body = 'OK';

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'add', ticket: objData });
    connections.forEach(conn => {
        if (conn.clientId !== clientId) {
            conn.res.write(`data: ${messClient}\n\n`);
        }
    });
    next();
});

app.use((ctx, next) => {
    if (ctx.request.method !== 'POST') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'dataLoading') {
        next();
        return;
    }

    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;

    const objData = (typeof (ctx.request.body) == 'string') ? JSON.parse(ctx.request.body) : ctx.request.body;

    if (objData.length == 0) {
        next();
        return;
    }
    deleteAllFilesInDirectory(pub);

    objData.forEach(elem => {
        let nameFile = path.join(pub, elem.id);
        let jsonData = JSON.stringify(elem);
        fs.writeFileSync(nameFile, jsonData);
    });

    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.body = 'OK';

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'reloaddata'});
    connections.forEach(conn => {
        if (conn.clientId !== clientId) {
            conn.res.write(`data: ${messClient}\n\n`);
        }
    });
    next();
});


app.use((ctx, next) => {
    if (ctx.request.method !== 'GET') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'allTickets') {
        next();
        return;
    }

    const files = fs.readdirSync(pub);
    const respData = [];

    for (let file of files) {
        let data = fs.readFileSync(path.join(pub, file));
        respData.push(JSON.parse(data));
    }

    ctx.response.body = JSON.stringify(respData);
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.set('Content-Type', 'application/json');
    next();

});



app.use((ctx, next) => {
    if (ctx.request.method !== 'GET') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'allTicketsPart') {
        next();
        return;
    }
    const count = Number(ctx.request.query.count);
    const shift = Number(ctx.request.query.shift);

    const files = fs.readdirSync(pub);
    const respData = [];
    const rpData = [];

    for (let file of files) {
        let data = fs.readFileSync(path.join(pub, file));
        respData.push(JSON.parse(data));
    }
    respData.sort((a, b) => b.date - a.date); //по убыванию
    const firstElem = (shift - 1) * count;
    const nextItem = Math.min(count + firstElem, respData.length);

    for (let i = firstElem; i < nextItem; i++) {
        rpData.push(respData[i]);
    }

    ctx.response.body = JSON.stringify({ data: rpData, totalCount: respData.length });
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.set('Content-Type', 'application/json');
    next();

});


app.use((ctx, next) => {
    if (ctx.request.method !== 'POST') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'updateById') {
        next();
        return;
    }


    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;

    const objData = (typeof (ctx.request.body) == 'string') ? JSON.parse(ctx.request.body) : ctx.request.body;

    const nameFile = path.join(pub, objData.id);
    const jsonData = JSON.stringify(objData);


    try {
        fs.accessSync(nameFile, fs.constants.R_OK);
        fs.writeFileSync(nameFile, jsonData);
    } catch (err) {
        ctx.response.status = 400;
        ctx.response.body = 'Ошибка работы с файлами';
        return;
    }
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.body = 'OK';

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'update', ticket: objData });
    connections.forEach(conn => {
        if (conn.clientId !== clientId) {
            conn.res.write(`data: ${messClient}\n\n`);
        }
    });
    next();
});

app.use((ctx, next) => {
    if (ctx.request.method !== 'GET') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'ticketById') {
        next();
        return;
    }

    const nameFile = path.join(pub, ctx.request.query.id);

    try {
        fs.accessSync(nameFile, fs.constants.R_OK);
        let data = fs.readFileSync(nameFile);
        ctx.response.body = data;
    } catch (err) {
        ctx.response.status = 400;
        ctx.response.body = 'Файл недоступен';
        return;
    }
    ctx.response.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use((ctx, next) => {
    if (ctx.request.method !== 'PUT') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'ticketPinned') {
        next();
        return;
    }

    const id = ctx.request.query.id;
    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;

    if ((!pinned)||(pinned.id != id)) {
        const nameFile = path.join(pub, id);
        try {
            fs.accessSync(nameFile, fs.constants.R_OK);
            let data = fs.readFileSync(nameFile);
            pinned = JSON.parse(data);           
        } catch (err) {
            ctx.response.status = 400;
            ctx.response.body = 'Файл недоступен';
            return;
        }
    }
    ctx.response.body = 'OK';
    ctx.response.set('Access-Control-Allow-Origin', '*');

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'pinned', ticket: pinned });
    connections.forEach(conn => {
        if (conn.clientId !== clientId) {
            conn.res.write(`data: ${messClient}\n\n`);
        }
    });

    next();
});

app.use((ctx, next) => {
    if (ctx.request.method !== 'DELETE') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'ticketUnPinned') {
        next();
        return;
    }

    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;

    pinned = null;

    ctx.response.body = 'OK';
    ctx.response.set('Access-Control-Allow-Origin', '*');

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'unpinned'});
    connections.forEach(conn => {
        if (conn.clientId !== clientId) {
            conn.res.write(`data: ${messClient}\n\n`);
        }
    });

    next();
});




app.use((ctx, next) => {
    if (ctx.request.method !== 'DELETE') {
        next();
        return;
    }

    if (!('method' in ctx.request.query)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неизвестная команда';
        return;
    }

    if (ctx.request.query.method !== 'deleteById') {
        next();
        return;
    }

    const clientId = ctx.request.query.clientId;
    ctx.disableBodyParser = true;
 
    const id = ctx.request.query.id;
    const nameFile = path.join(pub, id);

    try {
        fs.accessSync(nameFile, fs.constants.W_OK);
    } catch (err) {
        ctx.response.status = 400;
        ctx.response.body = 'Файл недоступен';
        return;
    }

    try {
        fs.unlinkSync(nameFile);
    } catch (err) {
        ctx.response.status = 400;
        ctx.response.body = 'Файл недоступен';
        return;
    }
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.body = 'OK';

    // Отправляем сообщение всем подключенным клиентам
    const messClient = JSON.stringify({ action: 'delete', id });
    connections.forEach(conn => {
        conn.res.write(`data: ${messClient}\n\n`);
    });


    next();
});


const server = http.createServer(app.callback());

const port = process.env.PORT || 7070;

server.listen(port, (err) => {
    if (err) {
        console.log(err);
        return;
    }

    console.log('Server is listening to ' + port);
});
