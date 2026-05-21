const EMAIL_PATTERN =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i;

const COMMON_EMAIL_DOMAIN_TYPOS = new Set([
  "gamil.com",
  "gmial.com",
  "gmai.com",
  "gmal.com",
  "gnail.com",
  "gmail.con",
  "gmail.co",
  "gmail.cm",
  "gmail.om",
  "gmail.cim",
  "hotmial.com",
  "hotmai.com",
  "yaho.com",
  "yahoo.co",
]);

export const EMAIL_VALIDATION_MESSAGE = "Enter a valid email address";

export const normalizeEmailInput = (email = "") => email.trim().toLowerCase();

export const isValidEmailAddress = (email = "") => {
  const normalizedEmail = normalizeEmailInput(email);

  if (!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
    return false;
  }

  const parts = normalizedEmail.split("@");
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (
    !localPart ||
    !domain ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    domain.includes("..") ||
    COMMON_EMAIL_DOMAIN_TYPOS.has(domain)
  ) {
    return false;
  }

  return domain
    .split(".")
    .every((label) => label && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-"));
};
