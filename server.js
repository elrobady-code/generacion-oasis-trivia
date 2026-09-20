const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let salas = {}; // Almacena múltiples salas simultáneas

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Crear sala nueva
    socket.on('crearSala', (data) => {
        const { codigo, tematicas, listaPreguntas } = data;
        
        salas[codigo] = {
            host: socket.id,
            tematicas: tematicas,
            preguntas: listaPreguntas && listaPreguntas.length > 0 ? listaPreguntas : [
                { pregunta: "¿Cómo se llama el guía de esta aventura bíblica?", opciones: ["Melki", "Josué", "David", "Moisés"], correcta: 0 }
            ],
            indicePregunta: 0,
            jugadores: {},
            estado: 'esperando'
        };

        socket.join(codigo);
        socket.emit('salaCreadaExito', codigo);
        console.log(`Sala creada con éxito: ${codigo}`);
    });

    // Unirse a sala existente
    socket.on('unirseSala', (data) => {
        const { codigo, nombre, avatar } = data;
        const salaUpper = codigo.toUpperCase();

        if (salas[salaUpper]) {
            salas[salaUpper].jugadores[socket.id] = { nombre, avatar, puntaje: 0 };
            socket.join(salaUpper);
            socket.emit('unidoExito', salaUpper);
            
            // Actualizar la lista en la pantalla del Host de esa sala
            io.to(salas[salaUpper].host).emit('actualizarListaJugadores', salas[salaUpper].jugadores);
        } else {
            socket.emit('errorUnirse', 'Esta sala no existe o el código es incorrecto.');
        }
    });

    // Anfitrión avanza a la siguiente pregunta
    socket.on('siguientePregunta', (codigo) => {
        const sala = salas[codigo];
        if (sala && socket.id === sala.host) {
            if (sala.indicePregunta < sala.preguntas.length) {
                const preguntaActual = sala.preguntas[sala.indicePregunta];
                
                io.to(sala.host).emit('mostrarPreguntaHost', preguntaActual);
                io.to(codigo).emit('nuevaPreguntaJugador', {
                    preguntaIndex: sala.indicePregunta,
                    total: sala.preguntas.length
                });

                sala.indicePregunta++;
            } else {
                io.to(codigo).emit('juegoTerminado');
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});