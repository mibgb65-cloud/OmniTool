const DATABASE_NAME = "omnitool";
const DATABASE_VERSION = 1;
const STORE_NAME = "vault";
const KEY_ID = "encryption-key";
const ACCOUNTS_ID = "accounts";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue(id) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeValue(id, value) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getEncryptionKey() {
  const storedKey = await readValue(KEY_ID);

  if (storedKey) {
    return storedKey;
  }

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await writeValue(KEY_ID, key);
  return key;
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function loadAccounts() {
  const encrypted = await readValue(ACCOUNTS_ID);

  if (!encrypted) {
    return [];
  }

  const key = await getEncryptionKey();
  const plainText = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) },
    key,
    base64ToBytes(encrypted.data),
  );
  const accounts = JSON.parse(decoder.decode(plainText));

  return Array.isArray(accounts) ? accounts : [];
}

export async function saveAccounts(accounts) {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(accounts)),
  );

  await writeValue(ACCOUNTS_ID, {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipherText)),
  });
}

