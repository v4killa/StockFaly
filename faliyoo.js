// CARGAR VARIABLES DE ENTORNO - DEBE SER LA PRIMERA LÍNEA
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { MongoClient } = require('mongodb');
const http = require('http'); // ← NUEVA LÍNEA

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// ← AGREGAR AQUÍ LAS SIGUIENTES LÍNEAS:
// SISTEMA ANTI-INACTIVIDAD PARA RENDER
let ultimaActividad = Date.now();
let canalNotificaciones = null;
let contadorRefresh = 0;

const mensajesRefresh = [
    '🔧 Sistema activo - Inventario sincronizado',
    '📊 Verificando stock automáticamente...',
    '⚡ Bot en línea - Listo para operaciones',
    '🎮 Servidor GTA RP - Sistema funcionando',
    '💾 Respaldo automático completado',
    '🔄 Refrescando conexión con base de datos',
    '📡 Manteniendo conexión activa...',
    '🛡️ Sistema de seguridad verificado'
];

// Configuración MongoDB


async function conectarMongoDB() {
    try {
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        console.log('✅ MongoDB Atlas conectado (modo multi-servidor)');
    } catch (error) {
        console.error('❌ Error conectando MongoDB:', error.message);
        process.exit(1);
    }
}
// Obtener base de datos única por servidor
function obtenerBaseDatos(guildId) {
    const nombreDB = `inventario_gta_${guildId}`;
    return mongoClient.db(nombreDB);
}

// Obtener inventario específico del servidor
async function obtenerInventarioServidor(guildId) {
    if (!inventarios.has(guildId)) {
        const dbServidor = obtenerBaseDatos(guildId);
        const collection = dbServidor.collection('productos');
        
        try {
            const productos = await collection.find({}).toArray();
            const inventario = {};
            
            productos.forEach(p => {
                if (p.nombre && typeof p.nombre === 'string') {
                    const cantidad = Number(p.cantidad);
                    const precio = Number(p.precio);
                    inventario[p.nombre] = {
                        cantidad: isNaN(cantidad) ? 0 : Math.max(0, cantidad),
                        precio: isNaN(precio) ? 0 : Math.max(0, precio)
                    };
                }
            });
            
            inventarios.set(guildId, inventario);
            console.log(`✅ Inventario cargado servidor ${guildId}:`, Object.keys(inventario).length, 'items');
        } catch (error) {
            console.error(`❌ Error cargando inventario servidor ${guildId}:`, error.message);
            inventarios.set(guildId, {});
        }
    }
    
    return inventarios.get(guildId);
}

// Guardar inventario específico del servidor
async function guardarInventarioServidor(guildId) {
    try {
        const inventario = inventarios.get(guildId) || {};
        const dbServidor = obtenerBaseDatos(guildId);
        const collection = dbServidor.collection('productos');
        
        const operaciones = Object.entries(inventario).map(([nombre, datos]) => ({
            updateOne: {
                filter: { nombre },
                update: {
                    $set: {
                        nombre,
                        cantidad: Number(datos.cantidad) || 0,
                        precio: Number(datos.precio) || 0,
                        ultimaActualizacion: new Date(),
                        guildId: guildId
                    }
                },
                upsert: true
            }
        }));
        
        if (operaciones.length > 0) {
            await collection.bulkWrite(operaciones);
            console.log(`✅ Guardado servidor ${guildId}: ${operaciones.length} productos`);
        }
    } catch (error) {
        console.error(`❌ Error guardando servidor ${guildId}:`, error.message);
    }
}

// Inicializar productos para un servidor específico
async function inicializarProductosServidor(guildId) {
    const inventario = await obtenerInventarioServidor(guildId);
    const todosProductos = Object.values(productos).flatMap(cat => Object.values(cat));
    let inicializado = false;
    
    for (const producto of todosProductos) {
        if (!(producto in inventario)) {
            inventario[producto] = { cantidad: 0, precio: 0 };
            inicializado = true;
        }
    }
    
    if (inicializado) {
        inventarios.set(guildId, inventario);
        await guardarInventarioServidor(guildId);
    }
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    restTimeOffset: 0
});

let inventarios = new Map(); // Cache de inventarios por servidor
let mongoClient; // Cliente MongoDB global
let sesionesActivas = new Map();

// Productos organizados - ROPA Y TATUAJES SEPARADOS
const productos = {
    'armas': { '🔫': 'glock', '🏹': 'vintage', '💣': 'beretta', '🪓': 'hachas', '🔪': 'machetes' },
    'cargadores': { '📦': 'cargador pistolas', '🗃️': 'cargador subfusil' },
    'drogas': { '🚬': 'bongs', '💊': 'pcp', '🍪': 'galletas', '💉': 'fentanilo', '🌿': 'marihuana' },
    'planos': { 
        '🏪': 'supermercado', 
        '⛽': 'gasolinera', 
        '💎': 'joyeria', 
        '💇': 'barberia', 
        '🍺': 'licoreria', 
        '➕': 'farmacia', 
        '🛠️': 'arquitectónico', 
        '👕': 'ropa',
        '🎨': 'tatuajes'
    }
};

const categoriaEmojis = { 'armas': '🔫', 'cargadores': '📦', 'drogas': '💊', 'planos': '🗺️' };


// Utilidades
function crearEmbed(title, color = '#8b0000') {
    return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

function obtenerEmojiProducto(nombreProducto) {
    for (const categoria of Object.values(productos)) {
        for (const [emoji, nombre] of Object.entries(categoria)) {
            if (nombre.toLowerCase().trim() === nombreProducto.toLowerCase().trim()) return emoji;
        }
    }
    return '📦';
}

function crearBotones(botones) {
    const rows = [];
    for (let i = 0; i < botones.length; i += 5) {
        const row = new ActionRowBuilder();
        const chunk = botones.slice(i, i + 5);
        chunk.forEach(btn => row.addComponents(btn));
        rows.push(row);
    }
    return rows;
}

function codificarNombre(nombre) {
    return Buffer.from(nombre).toString('base64');
}

function decodificarNombre(nombreCodificado) {
    try {
        return Buffer.from(nombreCodificado, 'base64').toString('utf8');
    } catch {
        return nombreCodificado.replace(/_/g, ' ');
    }
}
// --- FUNCIONES ANTI-INACTIVIDAD ---
async function obtenerCanalNotificaciones() {
    if (canalNotificaciones) return canalNotificaciones;
    
    try {
        const canalesPreferidos = ['bot-logs', 'sistema', 'general', 'inventario'];
        
        for (const guild of client.guilds.cache.values()) {
            for (const nombreCanal of canalesPreferidos) {
                const canal = guild.channels.cache.find(ch => 
                    ch.name.toLowerCase().includes(nombreCanal) && 
                    ch.isTextBased() &&
                    ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
                );
                if (canal) {
                    canalNotificaciones = canal;
                    console.log(`✅ Canal de notificaciones: #${canal.name}`);
                    return canal;
                }
            }
            
            // Si no encuentra canales específicos, usar el primero disponible
            const canalGeneral = guild.channels.cache.find(ch => 
                ch.isTextBased() &&
                ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
            );
            if (canalGeneral) {
                canalNotificaciones = canalGeneral;
                console.log(`✅ Canal de notificaciones: #${canalGeneral.name}`);
                return canalGeneral;
            }
        }
    } catch (error) {
        console.error('❌ Error configurando canal:', error.message);
    }
    return null;
}

function registrarActividad() {
    ultimaActividad = Date.now();
}

async function enviarMensajeMantenimiento() {
    const canal = await obtenerCanalNotificaciones();
    if (!canal) return;

    try {
        contadorRefresh++;
        const mensaje = mensajesRefresh[Math.floor(Math.random() * mensajesRefresh.length)];
        
        const embed = new EmbedBuilder()
            .setColor('#28a745')
            .setTitle('🤖 Sistema Activo')
            .setDescription(`${mensaje}\n\n🕐 **Uptime:** ${Math.floor(process.uptime() / 60)} minutos\n📈 **Refresh #${contadorRefresh}**`)
            .setTimestamp()
            .setFooter({ text: 'Mantenimiento automático - Render' });

        const mensajeEnviado = await canal.send({ embeds: [embed] });

        // Eliminar mensaje después de 30 segundos
        setTimeout(async () => {
            try {
                await mensajeEnviado.delete();
            } catch {}
        }, 30000);

        console.log(`🔄 Mensaje mantenimiento enviado (${new Date().toLocaleTimeString()})`);
        
    } catch (error) {
        console.error('❌ Error enviando mantenimiento:', error.message);
    }
}
// --- PANTALLAS CON BOTONES ---
async function mostrarHome(interaction, editar = false) {
    const embed = crearEmbed('🎮 Inventario GTA RP', '#4169e1')
        .setDescription(`**Selecciona una categoría para gestionar:**\n\n🔫 **Armas** - Pistolas y armamento\n📦 **Cargadores** - Munición\n💊 **Drogas** - Sustancias\n🗺️ **Planos** - Mapas de locaciones\n\n📊 **Ver stock completo**`);

    const botones = [
        new ButtonBuilder().setCustomId('cat_armas').setLabel('Armas').setEmoji('🔫').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cat_cargadores').setLabel('Cargadores').setEmoji('📦').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cat_drogas').setLabel('Drogas').setEmoji('💊').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cat_planos').setLabel('Planos').setEmoji('🗺️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('stock_completo').setLabel('Stock Completo').setEmoji('📊').setStyle(ButtonStyle.Secondary)
    ];

    const rows = crearBotones(botones);
    
    if (editar) {
        await interaction.update({ embeds: [embed], components: rows });
    } else {
        const response = await interaction.reply({ embeds: [embed], components: rows });
        sesionesActivas.set(interaction.user.id, { messageId: response.id, estado: 'home' });
    }
}

async function mostrarCategoria(interaction, categoria) {
    const productosCategoria = productos[categoria];
    const guildId = interaction.guild.id;
    const inventario = await obtenerInventarioServidor(guildId);
    if (!productosCategoria) {
        await interaction.reply({ 
            content: '❌ Categoría no encontrada', 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }
    
    const nombreCat = categoria.charAt(0).toUpperCase() + categoria.slice(1);
    const emojiCat = categoriaEmojis[categoria];
    
    let descripcion = `**Productos disponibles:**\n\n`;
    for (const [emoji, producto] of Object.entries(productosCategoria)) {
    const datosProducto = inventario[producto] || { cantidad: 0, precio: 0 };
    const stock = Number(datosProducto.cantidad) || 0;
    const precio = Number(datosProducto.precio) || 0;
    
    const estado = stock === 0 ? '🔴' : stock < 10 ? '🟡' : '🟢';
    descripcion += `${estado} ${emoji} **${producto}** - Stock: **${stock}** - 💵 $${precio.toFixed(2)}\n`;
}
    descripcion += `\n**Selecciona un producto para gestionar:**`;

    const embed = crearEmbed(`${emojiCat} ${nombreCat}`, '#28a745').setDescription(descripcion);

    const botones = Object.entries(productosCategoria).map(([emoji, producto]) => 
        new ButtonBuilder()
            .setCustomId(`prod_${codificarNombre(producto)}`)
            .setLabel(producto)
            .setEmoji(emoji)
            .setStyle(ButtonStyle.Success)
    );

    botones.push(new ButtonBuilder().setCustomId('home').setLabel('Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary));

    const rows = crearBotones(botones);
    await interaction.update({ embeds: [embed], components: rows });
    
    sesionesActivas.set(interaction.user.id, { 
        messageId: interaction.message.id, 
        estado: 'categoria', 
        categoria: categoria 
    });
}

async function mostrarProducto(interaction, producto) {
    let categoriaProducto = null;
    const guildId = interaction.guild.id;
    const inventario = await obtenerInventarioServidor(guildId);
    for (const [catNombre, catProductos] of Object.entries(productos)) {
        if (Object.values(catProductos).includes(producto)) {
            categoriaProducto = catNombre;
            break;
        }
    }
    
    const emoji = obtenerEmojiProducto(producto);
    const datosProducto = inventario[producto] || { cantidad: 0, precio: 0 };
const stock = Number(datosProducto.cantidad) || 0;
const precio = Number(datosProducto.precio) || 0;

    const estado = stock === 0 ? '🔴 Agotado' : stock < 10 ? '🟡 Stock Bajo' : '🟢 Stock Normal';
    
    const embed = crearEmbed(`${emoji} ${producto.toUpperCase()}`, '#ffc107')
       .setDescription(`**Stock actual: ${stock}** ${estado}
💵 **Precio unitario:** $${precio.toFixed(2)}

**¿Qué operación deseas realizar?**

➕ **Agregar** - Aumentar stock  
➖ **Retirar** - Reducir stock  
💰 **Cambiar precio**`);


    const botones = [
    new ButtonBuilder().setCustomId(`op_add_${codificarNombre(producto)}`).setLabel('Agregar Stock').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`op_remove_${codificarNombre(producto)}`).setLabel('Retirar Stock').setEmoji('➖').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`op_price_${codificarNombre(producto)}`).setLabel('Cambiar Precio').setEmoji('💰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('back').setLabel('Volver').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('home').setLabel('Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
];

    const rows = crearBotones(botones);
    await interaction.update({ embeds: [embed], components: rows });
    
    sesionesActivas.set(interaction.user.id, { 
        messageId: interaction.message.id, 
        estado: 'producto', 
        producto: producto,
        categoria: categoriaProducto
    });
}

async function mostrarCantidades(interaction, operacion, producto) {
    const todosProductos = Object.values(productos).flatMap(cat => Object.values(cat));
    const guildId = interaction.guild.id;
    const inventario = await obtenerInventarioServidor(guildId);
    if (!todosProductos.includes(producto)) {
        await interaction.reply({ 
            content: '❌ Producto no encontrado', 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }
    
    const emoji = obtenerEmojiProducto(producto);
    const datosProducto = inventario[producto] || { cantidad: 0, precio: 0 };
const stock = Number(datosProducto.cantidad) || 0;
    const titulo = operacion === 'add' ? 'Agregar Stock' : 'Retirar Stock';
    const color = operacion === 'add' ? '#28a745' : '#dc3545';
    
    const embed = crearEmbed(`${emoji} ${titulo}`, color)
        .setDescription(`**Producto:** ${producto}\n**Stock actual:** ${stock}\n\n**Selecciona la cantidad:**`);

    const productoCode = codificarNombre(producto);
    const botones = [
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_1`).setLabel('1').setEmoji('1️⃣').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_2`).setLabel('2').setEmoji('2️⃣').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_3`).setLabel('3').setEmoji('3️⃣').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_5`).setLabel('5').setEmoji('5️⃣').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_10`).setLabel('10').setEmoji('🔟').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_25`).setLabel('25').setEmoji('🔥').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`qty_${operacion}_${productoCode}_50`).setLabel('50').setEmoji('💥').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('back').setLabel('Volver').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('home').setLabel('Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
    ];

    const rows = crearBotones(botones);
    await interaction.update({ embeds: [embed], components: rows });
    
    const sesion = sesionesActivas.get(interaction.user.id) || {};
    sesionesActivas.set(interaction.user.id, { 
        messageId: interaction.message.id, 
        estado: 'cantidad', 
        producto: producto,
        operacion: operacion,
        categoria: sesion.categoria
    });
}

// FUNCIÓN CORREGIDA: Procesamiento de operaciones
async function procesarOperacion(interaction, operacion, producto, cantidad) {
    const guildId = interaction.guild.id;
    let inventario = await obtenerInventarioServidor(guildId);
    const emoji = obtenerEmojiProducto(producto);
    let resultado, color;
    
    // Convertir cantidad a número de forma segura
    const cantidadNum = parseInt(String(cantidad).trim(), 10);
    
    if (isNaN(cantidadNum) || cantidadNum <= 0) {
        await interaction.reply({ 
            content: `❌ Cantidad inválida: ${cantidad}`, 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }
    
    // Validar producto
    const todosProductos = Object.values(productos).flatMap(cat => Object.values(cat));
    if (!todosProductos.includes(producto)) {
        await interaction.reply({ 
            content: `❌ Producto no encontrado: ${producto}`, 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }
    
   // Inicializar si no existe
if (!(producto in inventario)) {
    inventario[producto] = { cantidad: 0, precio: 0 };
}

const datosProducto = inventario[producto];
const stockActual = Number(datosProducto.cantidad) || 0;

if (operacion === 'add') {
    inventario[producto].cantidad = stockActual + cantidadNum;
        resultado = `✅ **OPERACIÓN EXITOSA**\n\n${emoji} **${producto}**\n➕ **Agregado:** ${cantidadNum} unidades\n📊 **Nuevo stock:** ${inventario[producto].cantidad}`;
        color = '#28a745';
        inventarios.set(guildId, inventario);
        await guardarInventarioServidor(guildId);
   } else {
    if (stockActual < cantidadNum) {
        resultado = `❌ **STOCK INSUFICIENTE**\n\n${emoji} **${producto}**\n📊 **Stock disponible:** ${stockActual}\n🚫 **Cantidad solicitada:** ${cantidadNum}`;
        color = '#dc3545';
    } else {
        inventario[producto].cantidad = stockActual - cantidadNum;
        const precioUnitario = Number(inventario[producto].precio) || 0;
        const total = cantidadNum * precioUnitario;

        resultado = `📤 **OPERACIÓN EXITOSA**

${emoji} **${producto}**  
➖ **Retirado:** ${cantidadNum} unidades  
📊 **Stock restante:** ${inventario[producto].cantidad}  
💵 **Precio unitario:** $${precioUnitario.toFixed(2)}  
🧾 **Total generado:** $${total.toFixed(2)}`;

    color = '#dc3545';
        inventarios.set(guildId, inventario);
        await guardarInventarioServidor(guildId);
    }
}
    
    const embed = crearEmbed('⚡ Resultado de Operación', color).setDescription(resultado);

    const botones = [
        new ButtonBuilder().setCustomId(`prod_${codificarNombre(producto)}`).setLabel('Gestionar Producto').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back').setLabel('Volver').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('home').setLabel('Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
    ];

    const rows = crearBotones(botones);
    await interaction.update({ embeds: [embed], components: rows });
}

async function mostrarStockCompleto(interaction) {
    let descripcion = '';
    const guildId = interaction.guild.id;
    const inventario = await obtenerInventarioServidor(guildId);

    for (const [catNombre, catProductos] of Object.entries(productos)) {
        const emojiCat = categoriaEmojis[catNombre];
        descripcion += `\n**${emojiCat} ${catNombre.toUpperCase()}:**\n`;

        for (const [emoji, producto] of Object.entries(catProductos)) {
            const datosProducto = inventario[producto] || { cantidad: 0, precio: 0 };
            const stock = Number(datosProducto.cantidad) || 0;
            const precio = Number(datosProducto.precio) || 0;
            const estado = stock === 0 ? '🔴' : stock < 10 ? '🟡' : '🟢';
            descripcion += `${estado} ${emoji} ${producto}: **${stock}u** - 💵 $${precio.toFixed(2)}\n`;
        }
    }

    const embed = crearEmbed('📊 Stock Completo', '#17a2b8').setDescription(descripcion);

    const botones = [
        new ButtonBuilder().setCustomId('home').setLabel('Volver al Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary)
    ];

    const rows = crearBotones(botones);
    await interaction.update({ embeds: [embed], components: rows });
}


// MANEJADOR DE INTERACCIONES CORREGIDO
client.on('interactionCreate', async (interaction) => {
    registrarActividad(); // ← AGREGAR ESTA LÍNEA
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    
    try {
        if (customId === 'home') {
            await mostrarHome(interaction, true);
        }
        else if (customId === 'back') {
            const sesion = sesionesActivas.get(interaction.user.id);
            if (!sesion) {
                await mostrarHome(interaction, true);
                return;
            }
            
            if (sesion.estado === 'categoria') {
                await mostrarHome(interaction, true);
            } else if (sesion.estado === 'producto' && sesion.categoria) {
                await mostrarCategoria(interaction, sesion.categoria);
            } else if (sesion.estado === 'cantidad' && sesion.producto) {
                await mostrarProducto(interaction, sesion.producto);
            } else {
                await mostrarHome(interaction, true);
            }
        }
        else if (customId === 'stock_completo') {
            await mostrarStockCompleto(interaction);
        }
        else if (customId.startsWith('cat_')) {
            const categoria = customId.replace('cat_', '');
            await mostrarCategoria(interaction, categoria);
        }
        else if (customId.startsWith('prod_')) {
            const productoEncoded = customId.replace('prod_', '');
            const producto = decodificarNombre(productoEncoded);
            await mostrarProducto(interaction, producto);
        }
        else if (customId.startsWith('op_add_') || customId.startsWith('op_remove_')) {
    const parts = customId.split('_');
    const operacion = parts[1]; // 'add' o 'remove'
    const productoEncoded = parts.slice(2).join('_');
    const producto = decodificarNombre(productoEncoded);
    
    await mostrarCantidades(interaction, operacion, producto);
} 
else if (customId.startsWith('op_price_')) {
    const productoEncoded = customId.replace('op_price_', '');
    const producto = decodificarNombre(productoEncoded);
    
    const modal = new ModalBuilder()
        .setCustomId(`modal_price_${codificarNombre(producto)}`)
        .setTitle(`💰 Cambiar Precio - ${producto}`);

    const precioInput = new TextInputBuilder()
        .setCustomId('precio_input')
        .setLabel('Nuevo Precio (solo números)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ejemplo: 150.50')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    const firstActionRow = new ActionRowBuilder().addComponents(precioInput);
    modal.addComponents(firstActionRow);
    
    await interaction.showModal(modal);
}
        else if (customId.startsWith('qty_')) {
            const parts = customId.split('_');
            if (parts.length < 4) {
                await interaction.reply({ 
                    content: '❌ Formato de botón inválido', 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            

            
            const operacion = parts[1];
            const productoEncoded = parts[2];
            const cantidadStr = parts[3];
            
            const cantidad = parseInt(cantidadStr.trim(), 10);
            const producto = decodificarNombre(productoEncoded);
            
            if (isNaN(cantidad) || cantidad <= 0) {
                await interaction.reply({ 
                    content: `❌ Cantidad inválida: ${cantidadStr}`, 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            
            if (!producto || producto.trim() === '') {
                await interaction.reply({ 
                    content: '❌ Producto no válido', 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            
            await procesarOperacion(interaction, operacion, producto, cantidad);
        }

    } catch (error) {
        console.error('❌ Error en interacción:', error);
        
        const errorMsg = `❌ Error procesando operación: ${error.message}`;
        
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ 
                    content: errorMsg, 
                    flags: MessageFlags.Ephemeral 
                });
            } else {
                await interaction.reply({ 
                    content: errorMsg, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        } catch (replyError) {
            console.error('❌ Error enviando respuesta de error:', replyError);
        }
    }
});
// MANEJADOR PARA MODALES (CORREGIDO)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    registrarActividad();

    if (interaction.customId.startsWith('modal_price_')) {
        const productoEncoded = interaction.customId.replace('modal_price_', '');
        const producto = decodificarNombre(productoEncoded);
        const guildId = interaction.guild.id; // ← LÍNEA AGREGADA
        
        const nuevoPrecio = parseFloat(
            interaction.fields.getTextInputValue('precio_input').replace(/[^\d.]/g, '')
        );

        if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
            await interaction.reply({
                content: '❌ Precio inválido. Debe ser un número positivo.',
                ephemeral: true
            });
            return;
        }

        // CORREGIDO: Usar sistema de inventario por servidor
        let inventario = await obtenerInventarioServidor(guildId);
        
        // Inicializar producto si no existe
        if (!inventario[producto]) {
            inventario[producto] = { cantidad: 0, precio: 0 };
        }

        inventario[producto].precio = nuevoPrecio;
        inventarios.set(guildId, inventario); // ← LÍNEA AGREGADA
        await guardarInventarioServidor(guildId); // ← LÍNEA CORREGIDA

        const emoji = obtenerEmojiProducto(producto);
        const embed = crearEmbed('✅ Precio Actualizado', '#28a745')
            .setDescription(
                `${emoji} **${producto}**\n` +
                `💰 **Nuevo precio:** $${nuevoPrecio.toFixed(2)}\n\n` +
                `¿Qué deseas hacer ahora?`
            );

        const botones = [
            new ButtonBuilder()
                .setCustomId(`prod_${codificarNombre(producto)}`)
                .setLabel('Gestionar Producto')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('home')
                .setLabel('Inicio')
                .setEmoji('🏠')
                .setStyle(ButtonStyle.Secondary)
        ];

        const rows = crearBotones(botones);

        await interaction.reply({
            embeds: [embed],
            components: rows
        });
    }
});
// --- COMANDOS DE TEXTO ---
const comandos = {
    async inventario(message) {
        const embed = crearEmbed('🎮 Inventario GTA RP', '#4169e1')
            .setDescription(`**Selecciona una categoría para gestionar:**\n\n🔫 **Armas** - Pistolas y armamento\n📦 **Cargadores** - Munición\n💊 **Drogas** - Sustancias\n🗺️ **Planos** - Mapas de locaciones\n\n📊 **Ver stock completo**`);

        const botones = [
            new ButtonBuilder().setCustomId('cat_armas').setLabel('Armas').setEmoji('🔫').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cat_cargadores').setLabel('Cargadores').setEmoji('📦').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cat_drogas').setLabel('Drogas').setEmoji('💊').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cat_planos').setLabel('Planos').setEmoji('🗺️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stock_completo').setLabel('Stock Completo').setEmoji('📊').setStyle(ButtonStyle.Secondary)
        ];

        const rows = crearBotones(botones);
        const response = await message.reply({ embeds: [embed], components: rows });
        sesionesActivas.set(message.author.id, { messageId: response.id, estado: 'home' });
    },
    
    async stock(message, args) {
        if (args.length === 0) {
            const guildId = message.guild.id;
        const inventario = await obtenerInventarioServidor(guildId);
            let descripcion = '**📊 STOCK RÁPIDO:**\n\n';
let totalValor = 0;

for (const [catNombre, catProductos] of Object.entries(productos)) {
    for (const [emoji, producto] of Object.entries(catProductos)) {
        const datosProducto = inventario[producto] || { cantidad: 0, precio: 0 };
        const stock = Number(datosProducto.cantidad) || 0;
        const precio = Number(datosProducto.precio) || 0;
        const estado = stock === 0 ? '🔴' : stock < 10 ? '🟡' : '🟢';
        descripcion += `${estado} ${emoji} ${producto}: **${stock}u** - 💵 $${precio.toFixed(2)}\n`;
        totalValor += stock * precio;
    }

}

descripcion += `\n💰 **Valor total del inventario:** $${totalValor.toFixed(2)}`;

await message.reply({ embeds: [crearEmbed('📋 Stock Completo', '#17a2b8').setDescription(descripcion)] });

        } else {
            const termino = args.join(' ').toLowerCase();
            const guildId = message.guild.id;
    const inventario = await obtenerInventarioServidor(guildId);
            const todosProductos = Object.values(productos).flatMap(cat => Object.values(cat));
            const encontrados = todosProductos.filter(p => p.toLowerCase().includes(termino));
            
            if (encontrados.length === 0) {
                await message.reply({ embeds: [crearEmbed('❌ No encontrado', '#dc3545').setDescription(`Sin resultados para: **${termino}**`)] });
                return;
            }
            
            let descripcion = `**🔍 "${termino}":**\n\n`;
            for (const producto of encontrados) {
    const stock = Number(inventario[producto]?.cantidad || 0);
    const precio = Number(inventario[producto]?.precio || 0);
    const emoji = obtenerEmojiProducto(producto);
    const estado = stock === 0 ? '🔴' : stock < 10 ? '🟡' : '🟢';
    descripcion += `${estado}${emoji} **${producto}**: ${stock}u - 💵 $${precio.toFixed(2)}\n`;
}

            
            await message.reply({ embeds: [crearEmbed('📋 Encontrado', '#28a745').setDescription(descripcion)] });
        }
    },

    async ayuda(message) {
        const embed = crearEmbed('🔫 Guía del Bot')
            .setDescription(`**COMANDOS:**\n• \`!inventario\` - Abrir interfaz interactiva\n• \`!stock [producto]\` - Buscar/Ver stock\n• \`!ayuda\` - Esta guía\n\n**USO:**\n🖱️ **Clickea los botones** para navegar\n✅ **Interfaz intuitiva** con botones\n⚡ **Operaciones rápidas** (1-50 unidades)\n\n**ESTADOS:**\n🟢 Stock Normal | 🟡 Stock Bajo | 🔴 Agotado`);
        await message.reply({ embeds: [embed] });
    }
};

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;
    
    registrarActividad(); // ← AGREGAR ESTA LÍNEA
    
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const aliases = { 'help': 'ayuda', 'inv': 'inventario', 'start': 'inventario', 's': 'stock' };
    const comando = aliases[cmd] || cmd;
    
    if (comandos[comando]) {
        try {
            await comandos[comando](message, args);
        } catch (error) {
            console.error('❌ Error comando:', error.message);
            await message.reply('❌ Error procesando comando');
        }
    }
});

// --- EVENTOS Y CONFIGURACIÓN ---
client.on('ready', async () => {
    console.log(`✅ Bot conectado: ${client.user.tag}`);
    client.user.setActivity('Inventario GTA RP 🔫', { type: ActivityType.Watching });
    // Evento cuando el bot se une a un nuevo servidor
client.on('guildCreate', async (guild) => {
    console.log(`✅ Bot añadido a nuevo servidor: ${guild.name} (${guild.id})`);
    await inicializarProductosServidor(guild.id);
    console.log(`🎮 Inventario inicializado para ${guild.name}`);
});

// Evento cuando el bot es removido de un servidor
client.on('guildDelete', (guild) => {
    console.log(`❌ Bot removido del servidor: ${guild.name} (${guild.id})`);
    // Limpiar cache local (la base de datos se mantiene por si vuelven a agregar el bot)
    inventarios.delete(guild.id);
    console.log(`🗑️ Cache limpiado para ${guild.name}`);
});
    
    // Configurar sistema anti-inactividad
    await obtenerCanalNotificaciones();
    registrarActividad();
    
    // Iniciar servidor HTTP para health checks
    const port = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                bot_status: 'connected'
            }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
    
    server.listen(port, () => {
        console.log(`🌐 Servidor HTTP iniciado en puerto ${port}`);
    });
    
    // Inicializar inventarios para todos los servidores donde está el bot
    for (const guild of client.guilds.cache.values()) {
        await inicializarProductosServidor(guild.id);
        console.log(`✅ Servidor inicializado: ${guild.name} (${guild.id})`);
    }
    
    console.log(`🎮 Bot listo para ${client.guilds.cache.size} servidores`);
    
    console.log('🔄 Sistema anti-inactividad activado para Render');
});

client.on('error', error => console.error('❌ Error:', error.message));

setInterval(async () => {
    for (const guildId of inventarios.keys()) {
        await guardarInventarioServidor(guildId);
    }
    console.log(`💾 Auto-guardado completado para ${inventarios.size} servidores`);
}, 30000);
setInterval(() => {
    const now = Date.now();
    for (const [userId, sesion] of sesionesActivas.entries()) {
        if (now - (sesion.timestamp || now) > 30 * 60 * 1000) {
            sesionesActivas.delete(userId);
        }
    }
}, 5 * 60 * 1000);
// Sistema de monitoreo de inactividad
setInterval(async () => {
    const tiempoInactivo = Date.now() - ultimaActividad;
    const minutos = Math.floor(tiempoInactivo / (1000 * 60));
    
    if (minutos >= 10) { // 10 minutos sin actividad
        await enviarMensajeMantenimiento();
        registrarActividad();
    }
}, 2 * 60 * 1000); // Verificar cada 2 minutos
// Manejar señales de cierre correctamente para Render
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM recibido - Cerrando bot...');
    // Guardar todos los inventarios antes de cerrar
    for (const guildId of inventarios.keys()) {
        await guardarInventarioServidor(guildId);
    }
    console.log('💾 Todos los inventarios guardados');
    await mongoClient.close();
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT recibido - Cerrando bot...');
    // Guardar todos los inventarios antes de cerrar
    for (const guildId of inventarios.keys()) {
        await guardarInventarioServidor(guildId);
    }
    console.log('💾 Todos los inventarios guardados');
    await mongoClient.close();
    client.destroy();
    process.exit(0);
});

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// VALIDACIÓN DE VARIABLES DE ENTORNO AL FINAL
if (!DISCORD_TOKEN || !MONGODB_URI) {
    console.error('❌ Token Discord o URI MongoDB no configurados');
    console.error('❌ Crea un archivo .env con:');
    console.error('DISCORD_TOKEN=tu_token_aqui');
    console.error('MONGODB_URI=tu_uri_aqui');
    process.exit(1);
}

console.log('🚀 Iniciando bot con botones interactivos...');
conectarMongoDB().then(() => {
    client.login(DISCORD_TOKEN);
});
