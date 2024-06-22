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
    connections.forEach(conn => {
        if (conn.clientId!==clientId){
            conn.res.write(`data: ${jsonData}\n\n`);
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

    const objData = (typeof (ctx.request.body) == 'string') ? JSON.parse(ctx.request.body) : ctx.request.body;
    const nameFile = path.join(pub, ctx.request.query.id);

    if (!('id' in objData)) {
        ctx.response.status = 400;
        ctx.response.body = 'Неверные данные';
        return;
    }

    try {
        fs.accessSync(nameFile, fs.constants.R_OK);
        fs.writeFileSync(nameFile, JSON.stringify(objData));
    } catch (err) {
        ctx.response.status = 400;
        ctx.response.body = 'Ошибка работы с файлами';
        return;
    }    
    ctx.response.set('Access-Control-Allow-Origin', '*');
    ctx.response.body = 'OK';

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

    const nameFile = path.join(pub, ctx.request.query.id);

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