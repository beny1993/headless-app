import { postData } from '@/lib/api-client';
import { API_PATHS } from '@/lib/constant/paths';

/**
 * Starts a fresh Zarinpal attempt for `orderId` and sends the browser to the
 * gateway. The endpoint re-checks ownership and that the order still awaits
 * payment; a failure rejects, for the caller to show.
 */
export const startZarinpalPayment = async (orderId: string): Promise<void> => {
  const { redirectUrl } = await postData<{ redirectUrl: string }>(
    API_PATHS.PAYMENT_REQUEST,
    { orderId },
  );
  window.location.assign(redirectUrl);
};
