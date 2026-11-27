export class MathUtils {
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    static normalizeAngle(angle) {
        while (angle < 0) angle += 2 * Math.PI;
        while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
        return angle;
    }

    static roundTo(value, decimals = 1) {
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    static isValidNumber(value) {
        return typeof value === 'number' && !isNaN(value) && isFinite(value);
    }
}
