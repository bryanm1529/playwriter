import { redirect } from 'react-router';

export const loader = () => {
  throw redirect('https://github.com/sicmundus/browserwright');
};

export default function Index() {
  return null;
}
